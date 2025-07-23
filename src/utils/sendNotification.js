const Notification = require("../models/notification");
const { io } = require("../server");
const User = require("../models/user");

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
    const from = await User.findById(fromUserId);
    if (!from) return;

    let message = "";

    switch (type) {
      case "follow":
        message = `👤 @${from.username} just followed you`;
        break;
      case "review_like":
        message = `❤️ @${from.username} liked your review`;
        break;
      case "reaction":
        message = `🔥 @${from.username} liked your reply`;
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

    const notif = await Notification.create({
      type,
      from: fromUserId,
      to: toUserId,
      message,
      relatedId,
      movieId,
      listId,
      reviewId,
    });

    io.to(toUserId.toString()).emit("notification", notif);
  } catch (err) {
    console.error("❌ Error in sendNotification:", err.message);
  }
};

module.exports = sendNotification;
