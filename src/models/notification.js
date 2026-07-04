// src/models/notification.js

const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema(
  {
    // =========================
    // Notification identity
    // =========================

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

    read: {
      type: Boolean,
      default: false,
      index: true,
    },

    // Identifies which Scene world this notification belongs to.
    // "none" is used for follows, account notices, and system messages.
    mediaType: {
      type: String,
      enum: ["movie", "tv", "none"],
      default: "none",
      index: true,
    },

    // =========================
    // Shared references
    // =========================

    relatedId: {
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

    // =========================
    // Movie notification data
    // =========================

    movieId: {
      type: String,
      default: "",
    },

    movieTitle: {
      type: String,
      default: "",
    },

    moviePoster: {
      type: String,
      default: "",
    },

    // =========================
    // Scene TV notification data
    // =========================

    showId: {
      type: String,
      default: "",
    },

    showTitle: {
      type: String,
      default: "",
    },

    showPoster: {
      type: String,
      default: "",
    },

    seasonNumber: {
      type: Number,
      default: null,
      min: 0,
    },

    episodeNumber: {
      type: Number,
      default: null,
      min: 0,
    },

    episodeId: {
      type: String,
      default: "",
    },

    episodeTitle: {
      type: String,
      default: "",
    },

    episodeBackdrop: {
      type: String,
      default: "",
    },

    tvLogId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TVLog",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// =========================
// Indexes
// =========================

// Main notifications screen.
NotificationSchema.index({
  to: 1,
  createdAt: -1,
});

// Unread notification count and unread feed.
NotificationSchema.index({
  to: 1,
  read: 1,
  createdAt: -1,
});

// Filter notifications by Movies or Scene TV.
NotificationSchema.index({
  to: 1,
  mediaType: 1,
  createdAt: -1,
});

// Useful for preventing or finding repeated notification types.
NotificationSchema.index({
  to: 1,
  type: 1,
  createdAt: -1,
});

// Future release notifications.
NotificationSchema.index({
  showId: 1,
  seasonNumber: 1,
  episodeNumber: 1,
});

// =========================
// Validation cleanup
// =========================

NotificationSchema.pre("validate", function (next) {
  try {
    if (typeof this.message === "string") {
      this.message = this.message.trim();
    }

    // Preserve compatibility when old movie routes do not send mediaType.
    if (
      this.mediaType === "none" &&
      (this.movieId || this.movieTitle || this.moviePoster)
    ) {
      this.mediaType = "movie";
    }

    // Automatically classify TV notifications.
    if (
      this.showId ||
      this.showTitle ||
      this.episodeId ||
      this.tvLogId
    ) {
      this.mediaType = "tv";
    }

    next();
  } catch (error) {
    next(error);
  }
});

module.exports =
  mongoose.models.Notification ||
  mongoose.model("Notification", NotificationSchema);