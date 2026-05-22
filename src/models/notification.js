const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema(
  {
    movieTitle: { type: String, default: "" },
    moviePoster: { type: String, default: "" },

    type: {
      type: String,
      required: true,
      index: true,
    },

    from: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    to: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    message: {
      type: String,
      default: "",
    },

    relatedId: {
      type: String,
      default: "",
    },

    movieId: {
      type: String,
      default: "",
    },

    listId: {
      type: String,
      default: "",
    },

    reviewId: {
      type: String,
      default: "",
    },

    read: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

NotificationSchema.index({ to: 1, createdAt: -1 });
NotificationSchema.index({ to: 1, read: 1 });

module.exports = mongoose.model("Notification", NotificationSchema);

