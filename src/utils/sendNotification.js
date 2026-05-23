// /Users/saudceo/flick-backend/src/utils/sendNotification.js

const { Expo } = require("expo-server-sdk");
const Notification = require("../models/notification");
const User = require("../models/user");
const admin = require("firebase-admin");
const { io } = require("../server");

const expo = new Expo();

function normalizeTokenEntry(entry) {
  if (!entry) return null;

  if (typeof entry === "string") {
    const token = entry.trim();
    if (!token) return null;

    return {
      token,
      provider: token.startsWith("ExpoPushToken") ? "expo" : "fcm",
      platform: "unknown",
    };
  }

  const token = String(entry.token || entry.deviceToken || "").trim();
  if (!token) return null;

  return {
    token,
    provider: String(entry.provider || "").toLowerCase() || (token.startsWith("ExpoPushToken") ? "expo" : "fcm"),
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
      if (Expo.isExpoPushToken(entry.token)) return true;

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

  const chunks = expo.chunkPushNotifications(messages);

  console.log(`📨 Sending Expo push: ${messages.length} message(s)`);

  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);

      tickets.forEach((ticket, index) => {
        if (ticket.status === "ok") return;

        const failedToken = chunk[index]?.to;
        console.error("❌ Expo push failed:", failedToken, ticket.message, ticket.details);

        if (ticket.details?.error === "DeviceNotRegistered" && failedToken) {
          invalidTokens.add(failedToken);
        }
      });
    } catch (err) {
      console.error("❌ Expo chunk send error:", err?.message || err);
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

    // 1) Create notification in DB
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

    // 2) Re-fetch populated version for socket/UI
    const notif = await Notification.findById(createdNotif._id)
      .populate("from", "username avatar")
      .lean();

    // 3) Emit realtime socket event
    try {
      if (io) {
        io.to(String(toUserId)).emit("notification", notif);
      }
    } catch (sockErr) {
      console.warn("⚠️ Socket emit failed:", sockErr?.message || sockErr);
    }

    // 4) Respect push settings
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

    // 5) Device tokens
    const tokenEntries = Array.isArray(to.deviceTokens)
      ? to.deviceTokens.map(normalizeTokenEntry).filter(Boolean)
      : [];

    if (!tokenEntries.length) {
      console.log(`⚠️ No device tokens for user ${toUserId}`);
      return notif;
    }

    const expoEntries = tokenEntries.filter(
      (entry) =>
        entry.provider === "expo" ||
        entry.token.startsWith("ExpoPushToken")
    );

    const fcmEntries = tokenEntries.filter(
      (entry) =>
        entry.provider === "fcm" &&
        !entry.token.startsWith("ExpoPushToken")
    );

    console.log(
      `📲 Push tokens for ${toUserId}: expo=${expoEntries.length}, fcm=${fcmEntries.length}`
    );

    // 6) Badge count = unread notifications count
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

    // 7) Send push
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

    const invalidTokens = new Set([
      ...invalidExpoTokens,
      ...invalidFcmTokens,
    ]);

    // 8) Remove dead tokens
    if (invalidTokens.size) {
      to.deviceTokens = (to.deviceTokens || []).filter((entry) => {
        const token =
          typeof entry === "string"
            ? entry
            : entry?.token || entry?.deviceToken;

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