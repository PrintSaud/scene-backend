// /Users/saudceo/flick-backend/src/utils/sendNotification.js

const Notification = require("../models/notification");
const User = require("../models/user");
const admin = require("firebase-admin");
const { io } = require("../server");

function isExpoPushToken(token) {
  return (
    typeof token === "string" &&
    (token.startsWith("ExpoPushToken[") ||
      token.startsWith("ExponentPushToken["))
  );
}

function normalizeTokenEntry(entry) {
  if (!entry) return null;

  if (typeof entry === "string") {
    const token = entry.trim();
    if (!token) return null;

    return {
      token,
      provider: isExpoPushToken(token) ? "expo" : "fcm",
      platform: "unknown",
    };
  }

  const token = String(entry.token || entry.deviceToken || "").trim();
  if (!token) return null;

  const rawProvider = String(entry.provider || "").toLowerCase();

  return {
    token,
    provider: rawProvider || (isExpoPushToken(token) ? "expo" : "fcm"),
    platform: entry.platform || "unknown",
  };
}

function buildMessage({ type, from }) {
  switch (type) {
    case "follow":
      return `👤 @${from.username} just followed you`;
    case "review_like":
      return `❤️ @${from.username} liked your review`;
    case "reaction":
      return `❤️ @${from.username} liked your reply`;
    case "reply":
      return `💬 @${from.username} replied to your comment`;
    case "suggest_movie":
      return `🎬 @${from.username} suggested a movie for you`;
    case "share-list":
      return `📋 @${from.username} shared a list with you`;
    case "share-movie":
      return `🎞️ @${from.username} shared a movie with you`;
    case "share-review":
      return `✍️ @${from.username} shared a review with you`;
    default:
      return `🔔 @${from.username} sent you a notification`;
  }
}

async function sendExpoPushes({ expoEntries, message, data, badge }) {
  const invalidTokens = new Set();

  const messages = expoEntries
    .filter((entry) => {
      if (isExpoPushToken(entry.token)) return true;

      console.warn("⚠️ Invalid Expo push token skipped:", entry.token);
      invalidTokens.add(entry.token);
      return false;
    })
    .map((entry) => ({
      to: entry.token,
      sound: "default",
      title: "Scene",
      body: message,
      data,
      badge,
      priority: "high",
      channelId: "default",
    }));

  if (!messages.length) {
    return invalidTokens;
  }

  console.log(`📨 Sending Expo push: ${messages.length} message(s)`);

  const BATCH_SIZE = 100;

  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);

    try {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch.length === 1 ? batch[0] : batch),
      });

      let result = null;

      try {
        result = await response.json();
      } catch (jsonErr) {
        console.error("❌ Expo push non-JSON response:", jsonErr?.message || jsonErr);
      }

      if (!response.ok) {
        console.error("❌ Expo push HTTP error:", response.status, result);
        continue;
      }

      const tickets = Array.isArray(result?.data)
        ? result.data
        : result?.data
        ? [result.data]
        : [];

      tickets.forEach((ticket, index) => {
        if (!ticket) return;

        if (ticket.status === "ok") return;

        const failedToken = batch[index]?.to;

        console.error(
          "❌ Expo push failed:",
          failedToken,
          ticket.message,
          ticket.details
        );

        if (ticket.details?.error === "DeviceNotRegistered" && failedToken) {
          invalidTokens.add(failedToken);
        }
      });

      console.log(`✅ Expo push batch sent: ${batch.length}`);
    } catch (err) {
      console.error("❌ Expo push fetch error:", err?.message || err);
    }
  }

  return invalidTokens;
}

async function sendFcmPushes({ fcmEntries, message, data, badge }) {
  const invalidTokens = new Set();

  const fcmTokens = fcmEntries.map((entry) => entry.token).filter(Boolean);

  if (!fcmTokens.length) {
    return invalidTokens;
  }

  const payload = {
    notification: {
      title: "Scene",
      body: message,
    },
    data,
    apns: {
      headers: {
        "apns-priority": "10",
        "apns-push-type": "alert",
      },
      payload: {
        aps: {
          sound: "default",
          badge,
        },
      },
    },
    android: {
      priority: "high",
      notification: {
        sound: "default",
        channelId: "default",
      },
    },
  };

  try {
    const BATCH_SIZE = 450;

    console.log(`📨 Sending FCM push: ${fcmTokens.length} token(s)`);

    for (let i = 0; i < fcmTokens.length; i += BATCH_SIZE) {
      const batch = fcmTokens.slice(i, i + BATCH_SIZE);

      const response = await admin.messaging().sendEachForMulticast({
        tokens: batch,
        notification: payload.notification,
        data: payload.data,
        apns: payload.apns,
        android: payload.android,
      });

      console.log(
        `✅ FCM push batch result: success=${response.successCount}, failure=${response.failureCount}`
      );

      response.responses.forEach((r, idx) => {
        if (r.success) return;

        const err = r.error;
        const failedToken = batch[idx];

        console.error("❌ FCM token failed:", failedToken, err?.code, err?.message);

        if (
          err?.code === "messaging/registration-token-not-registered" ||
          err?.code === "messaging/invalid-registration-token"
        ) {
          invalidTokens.add(failedToken);
        }
      });
    }
  } catch (err) {
    console.error("❌ FCM send error:", err?.message || err);
  }

  return invalidTokens;
}

const sendNotification = async ({
  type,
  fromUserId,
  toUserId,
  relatedId = null,
  movieId = null,
  listId = null,
  reviewId = null,
}) => {
  try {
    if (!fromUserId || !toUserId) {
      console.warn("❌ sendNotification: missing fromUserId or toUserId");
      return null;
    }

    if (String(fromUserId) === String(toUserId)) {
      console.log("🔕 Push skipped: user notified themselves");
      return null;
    }

    const from = await User.findById(fromUserId).select("username avatar");
    if (!from) {
      console.warn("❌ sendNotification: from user not found");
      return null;
    }

    const to = await User.findById(toUserId).select("deviceTokens pushSettings");
    if (!to) {
      console.warn("❌ sendNotification: to user not found");
      return null;
    }

    const message = buildMessage({ type, from });

    const createdNotif = await Notification.create({
      type,
      from: fromUserId,
      to: toUserId,
      message,
      relatedId,
      movieId,
      listId,
      reviewId,
      read: false,
      createdAt: new Date(),
    });

    const notif = await Notification.findById(createdNotif._id)
      .populate("from", "username avatar")
      .lean();

    try {
      if (io) {
        io.to(String(toUserId)).emit("notification", notif);
      }
    } catch (sockErr) {
      console.warn("⚠️ Socket emit failed:", sockErr?.message || sockErr);
    }

    const pushSettings = to.pushSettings || {};

    if (pushSettings.muteAll) {
      console.log("🔕 Push skipped: muteAll enabled");
      return notif;
    }

    const typeToSetting = {
      follow: "muteFollow",
      reply: "muteReplies",
      reaction: "muteLikes",
      review_like: "muteLikes",
      "share-movie": "muteShares",
      "share-list": "muteShares",
      "share-review": "muteShares",
      suggest_movie: "muteSuggestions",
    };

    const muteKey = typeToSetting[type];

    if (muteKey && pushSettings[muteKey]) {
      console.log(`🔕 Push skipped: ${muteKey} enabled`);
      return notif;
    }

    const tokenEntries = Array.isArray(to.deviceTokens)
      ? to.deviceTokens.map(normalizeTokenEntry).filter(Boolean)
      : [];

    if (!tokenEntries.length) {
      console.log(`⚠️ No device tokens for user ${toUserId}`);
      return notif;
    }

    const expoEntries = tokenEntries.filter(
      (entry) => entry.provider === "expo" || isExpoPushToken(entry.token)
    );

    const fcmEntries = tokenEntries.filter(
      (entry) => entry.provider === "fcm" && !isExpoPushToken(entry.token)
    );

    console.log(
      `📲 Push tokens for ${toUserId}: expo=${expoEntries.length}, fcm=${fcmEntries.length}`
    );

    const unreadCount = await Notification.countDocuments({
      to: toUserId,
      read: false,
    });

    const data = {
      type: String(type || ""),
      notificationId: String(notif?._id || ""),
      relatedId: relatedId ? String(relatedId) : "",
      movieId: movieId ? String(movieId) : "",
      listId: listId ? String(listId) : "",
      reviewId: reviewId ? String(reviewId) : "",
      fromUserId: String(fromUserId || ""),
    };

    const invalidExpoTokens = await sendExpoPushes({
      expoEntries,
      message,
      data,
      badge: unreadCount,
    });

    const invalidFcmTokens = await sendFcmPushes({
      fcmEntries,
      message,
      data,
      badge: unreadCount,
    });

    const invalidTokens = new Set([...invalidExpoTokens, ...invalidFcmTokens]);

    if (invalidTokens.size) {
      to.deviceTokens = (to.deviceTokens || []).filter((entry) => {
        const token =
          typeof entry === "string" ? entry : entry?.token || entry?.deviceToken;

        return token && !invalidTokens.has(token);
      });

      await to.save();

      console.log(
        `🧹 Removed ${invalidTokens.size} invalid push token(s) from user ${toUserId}`
      );
    }

    return notif;
  } catch (err) {
    console.error("❌ Error in sendNotification:", err);
    return null;
  }
};

module.exports = sendNotification;

