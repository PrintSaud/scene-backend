console.log(`📨 Sending push to user ${toUserId} with ${tokens.length} token(s)`);
const Notification = require("../models/notification");
const User = require("../models/user");
const admin = require("firebase-admin");
const { io } = require("../server");

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

    let message = "";
    switch (type) {
      case "follow":
        message = `👤 @${from.username} just followed you`;
        break;
      case "review_like":
        message = `❤️ @${from.username} liked your review`;
        break;
      case "reaction":
        message = `❤️ @${from.username} liked your reply`;
        break;
      case "reply":
        message = `💬 @${from.username} replied to your comment`;
        break;
      case "suggest_movie":
        message = `🎬 @${from.username} suggested a movie for you`;
        break;
      case "share-list":
        message = `📋 @${from.username} shared a list with you`;
        break;
      case "share-movie":
        message = `🎞️ @${from.username} shared a movie with you`;
        break;
      case "share-review":
        message = `✍️ @${from.username} shared a review with you`;
        break;
      default:
        message = `🔔 @${from.username} sent you a notification`;
        break;
    }

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
      io.to(String(toUserId)).emit("notification", notif);
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
    };

    const muteKey = typeToSetting[type];
    if (muteKey && pushSettings[muteKey]) {
      console.log(`🔕 Push skipped: ${muteKey} enabled`);
      return notif;
    }

    // 5) Device tokens
    const tokenEntries = Array.isArray(to.deviceTokens) ? [...to.deviceTokens] : [];

const fcmTokens = tokenEntries
  .map((t) => (typeof t === "string" ? t : t.token))
  .filter(Boolean);

if (!fcmTokens.length) {
  console.log(`⚠️ No device tokens for user ${toUserId}`);
  return notif;
}

    // 6) Badge count = unread notifications count
    const unreadCount = await Notification.countDocuments({
      to: toUserId,
      read: false,
    });

    const payload = {
      notification: {
        title: "Scene",
        body: message,
      },
      data: {
        type: String(type || ""),
        relatedId: relatedId ? String(relatedId) : "",
        movieId: movieId ? String(movieId) : "",
        listId: listId ? String(listId) : "",
        reviewId: reviewId ? String(reviewId) : "",
        fromUserId: String(fromUserId || ""),
      },
      apns: {
        headers: {
          "apns-priority": "10",
          "apns-push-type": "alert",
        },
        payload: {
          aps: {
            sound: "default",
            badge: unreadCount,
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
      const invalidTokens = new Set();

      console.log(`📨 Sending push to user ${toUserId} with ${fcmTokens.length} token(s)`);

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
          `✅ Push batch result: success=${response.successCount}, failure=${response.failureCount}`
        );

        response.responses.forEach((r, idx) => {
          if (!r.success) {
            const err = r.error;
            console.error("❌ Push token failed:", batch[idx], err?.code, err?.message);

            if (
              err &&
              (
                err.code === "messaging/registration-token-not-registered" ||
                err.code === "messaging/invalid-registration-token"
              )
            ) {
              invalidTokens.add(batch[idx]);
            }
          }
        });
      }

      if (invalidTokens.size) {
        to.deviceTokens = (to.deviceTokens || []).filter((entry) => {
          const token = typeof entry === "string" ? entry : entry.token;
          return !invalidTokens.has(token);
        });
      
        await to.save();
        console.log(`🧹 Removed ${invalidTokens.size} invalid token(s) from user ${toUserId}`);
      }
    } catch (fcmErr) {
      console.error("❌ FCM send error:", fcmErr);
    }

    return notif;
  } catch (err) {
    console.error("❌ Error in sendNotification:", err);
    return null;
  }
};

module.exports = sendNotification;