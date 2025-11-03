const Notification = require("../models/notification");
const User = require("../models/user");
const admin = require("firebase-admin"); // initialized in server.js
const { io } = require("../server"); // ensure this exports io
// Note: if you export firebase admin differently, adapt require path.

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
    if (!from) return;

    const to = await User.findById(toUserId).select("deviceTokens pushSettings");
    if (!to) return;

    // Build message text
    let message = "";
    switch (type) {
      case "follow": message = `👤 @${from.username} just followed you`; break;
      case "review_like": message = `❤️ @${from.username} liked your review`; break;
      case "reaction": message = `❤️ @${from.username} liked your reply`; break;
      case "reply": message = `💬 @${from.username} replied to your comment`; break;
      case "suggest_movie": message = `🎬 @${from.username} suggested a movie for you`; break;
      case "share-list": message = `📋 @${from.username} shared a list with you`; break;
      case "share-movie": message = `🎞️ @${from.username} shared a movie with you`; break;
      case "share-review": message = `✍️ @${from.username} shared a review with you`; break;
      default: message = `🔔 @${from.username} sent you a notification`; break;
    }

    // Create notification record
    const notif = await Notification.create({
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

    // Emit socket to realtime clients
    try {
      io.to(String(toUserId)).emit("notification", notif);
    } catch (sockErr) {
      console.warn("Socket emit failed:", sockErr?.message || sockErr);
    }

    // Respect user push settings (skip if global mute)
    const pushSettings = to.pushSettings || {};
    if (pushSettings.muteAll) return notif;

    // Map notification types to per-type mute keys if used
    const typeToSetting = {
      follow: "muteFollow",
      reply: "muteReplies",
      reaction: "muteLikes",
      review_like: "muteLikes",
    };
    const muteKey = typeToSetting[type];
    if (muteKey && pushSettings[muteKey]) return notif;

    // Send FCM multicast if device tokens exist
    const tokens = Array.isArray(to.deviceTokens) ? to.deviceTokens.slice() : [];
    if (tokens.length === 0) return notif;

    // Compose FCM message payload
    const payload = {
      notification: {
        title: "Scene",
        body: message,
      },
      data: {
        type,
        relatedId: relatedId ? String(relatedId) : "",
        movieId: movieId ? String(movieId) : "",
        listId: listId ? String(listId) : "",
        reviewId: reviewId ? String(reviewId) : "",
      }
    };

    try {
      // Firebase supports up to 500 tokens in sendMulticast
      const BATCH_SIZE = 450;
      const invalidTokens = new Set();

      for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
        const batch = tokens.slice(i, i + BATCH_SIZE);

        const response = await admin.messaging().sendMulticast({
          tokens: batch,
          notification: payload.notification,
          data: payload.data,
        });

        // collect tokens that failed with permanent errors
        response.responses.forEach((r, idx) => {
          if (!r.success) {
            const err = r.error;
            // Common permanent errors: 'messaging/registration-token-not-registered', 'messaging/invalid-registration-token'
            if (err && (err.code === "messaging/registration-token-not-registered" || err.code === "messaging/invalid-registration-token")) {
              invalidTokens.add(batch[idx]);
            }
          }
        });
      }

      // If invalid tokens found, remove from user.deviceTokens (and save)
      if (invalidTokens.size) {
        const valid = tokens.filter(t => !invalidTokens.has(t));
        to.deviceTokens = valid;
        await to.save();
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
