// src/models/notification.js

const mongoose = require("mongoose");

const { Schema } = mongoose;

const notificationSchema = new Schema(
  {
    // ==================================================
    // Notification identity
    // ==================================================

    /**
     * Existing notification event type.
     *
     * We deliberately do not use an enum here because Scene already
     * has multiple Movie notification types and will continue adding
     * new types over time.
     *
     * Examples:
     * - follow
     * - movie_review_like
     * - movie_review_comment
     * - episode_review_like
     * - episode_review_comment
     * - show_review_like
     * - show_review_comment
     * - movie_shared
     * - show_shared
     * - episode_shared
     * - list_shared
     * - system
     */
    type: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    from: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    to: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    message: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },

    read: {
      type: Boolean,
      default: false,
      index: true,
    },

    readAt: {
      type: Date,
      default: null,
    },

    // ==================================================
    // Scene mode and frontend navigation
    // ==================================================

    /**
     * The Scene world this notification belongs to.
     *
     * none:
     * - follows
     * - account notices
     * - general system notifications
     */
    mediaType: {
      type: String,
      enum: ["movie", "tv", "none"],
      default: "none",
      required: true,
      index: true,
    },

    /**
     * Exact destination the frontend should open.
     *
     * The app compares mediaType with its current mode:
     *
     * - If they match, navigate normally.
     * - If they differ, animate the Movie/TV mode change first,
     *   then navigate to this target.
     */
    targetType: {
      type: String,
      enum: [
        "none",
        "profile",
        "movie",
        "movieReview",
        "show",
        "showReview",
        "episode",
        "episodeReview",
        "list",
        "notifications",
        "externalUrl",
      ],
      default: "none",
      index: true,
    },

    /**
     * Optional external target for system announcements.
     */
    targetUrl: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },

    // ==================================================
    // Shared references
    // ==================================================

    /**
     * General compatibility field retained for existing routes.
     */
    relatedId: {
      type: String,
      default: "",
      trim: true,
    },

    listId: {
      type: Schema.Types.ObjectId,
      ref: "List",
      default: null,
      index: true,
    },

    /**
     * Compatibility reference for existing Movie review routes.
     *
     * Some current routes may still store review IDs as strings.
     */
    reviewId: {
      type: String,
      default: "",
      trim: true,
    },

    // ==================================================
    // Movie notification data
    // ==================================================

    movieId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    movieTitle: {
      type: String,
      default: "",
      trim: true,
    },

    moviePoster: {
      type: String,
      default: "",
      trim: true,
    },

    /**
     * Optional reference to the Movie Log/Review document.
     *
     * Existing reviewId remains available for backward compatibility.
     */
    movieLogId: {
      type: Schema.Types.ObjectId,
      ref: "Log",
      default: null,
      index: true,
    },

    // ==================================================
    // Scene TV notification data
    // ==================================================

    /**
     * TMDB show ID stored as a string for consistency with the
     * existing Movie notification structure.
     */
    showId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    showTitle: {
      type: String,
      default: "",
      trim: true,
    },

    showPoster: {
      type: String,
      default: "",
      trim: true,
    },

    showBackdrop: {
      type: String,
      default: "",
      trim: true,
    },

    seasonNumber: {
      type: Number,
      default: null,
      min: 0,
    },

    episodeNumber: {
      type: Number,
      default: null,
      min: 1,
    },

    /**
     * TMDB episode ID.
     */
    episodeId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    episodeTitle: {
      type: String,
      default: "",
      trim: true,
    },

    episodeBackdrop: {
      type: String,
      default: "",
      trim: true,
    },

    /**
     * An Episode review is represented by the exact TVLog that
     * contains the written review.
     */
    tvLogId: {
      type: Schema.Types.ObjectId,
      ref: "TVLog",
      default: null,
      index: true,
    },

    /**
     * Dedicated reference for the upcoming ShowReview model.
     */
    showReviewId: {
      type: Schema.Types.ObjectId,
      ref: "ShowReview",
      default: null,
      index: true,
    },

    // ==================================================
    // Optional notification metadata
    // ==================================================

    /**
     * Used to prevent duplicate notifications when necessary.
     *
     * Example:
     * episode-review-like:<logId>:<likingUserId>
     *
     * Not every notification requires a deduplication key.
     */
    deduplicationKey: {
      type: String,
      default: null,
      trim: true,
    },

    /**
     * Flexible metadata for small future additions that do not
     * deserve a permanent top-level schema field.
     *
     * This should not replace important indexed navigation fields.
     */
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

// ======================================================
// Indexes
// ======================================================

// Main unified notification feed.
notificationSchema.index({
  to: 1,
  createdAt: -1,
});

// Unread count and unread feed.
notificationSchema.index({
  to: 1,
  read: 1,
  createdAt: -1,
});

// Movie/TV filtering within the Notifications screen.
notificationSchema.index({
  to: 1,
  mediaType: 1,
  createdAt: -1,
});

// Unread notifications within one mode.
notificationSchema.index({
  to: 1,
  mediaType: 1,
  read: 1,
  createdAt: -1,
});

// Find recent notifications of one event type.
notificationSchema.index({
  to: 1,
  type: 1,
  createdAt: -1,
});

// Find notifications targeting one destination type.
notificationSchema.index({
  to: 1,
  targetType: 1,
  createdAt: -1,
});

// Episode release and episode-specific notification queries.
notificationSchema.index({
  showId: 1,
  seasonNumber: 1,
  episodeNumber: 1,
  createdAt: -1,
});

// Prevent duplicated notifications when a route supplies a stable key.
notificationSchema.index(
  {
    to: 1,
    deduplicationKey: 1,
  },
  {
    unique: true,
    name: "unique_recipient_notification_deduplication",
    partialFilterExpression: {
      deduplicationKey: {
        $type: "string",
      },
    },
  }
);

// ======================================================
// Validation and normalization
// ======================================================

notificationSchema.pre(
  "validate",
  function normalizeNotification(next) {
    try {
      const trimFields = [
        "type",
        "message",
        "targetUrl",
        "relatedId",
        "reviewId",
        "movieId",
        "movieTitle",
        "moviePoster",
        "showId",
        "showTitle",
        "showPoster",
        "showBackdrop",
        "episodeId",
        "episodeTitle",
        "episodeBackdrop",
        "deduplicationKey",
      ];

      for (const field of trimFields) {
        if (typeof this[field] === "string") {
          this[field] = this[field].trim();
        }
      }

      if (!this.deduplicationKey) {
        this.deduplicationKey = null;
      }

      // Preserve compatibility when older Movie routes do not
      // explicitly provide mediaType.
      const hasMovieData = Boolean(
        this.movieId ||
          this.movieTitle ||
          this.moviePoster ||
          this.movieLogId
      );

      // Automatically classify Scene TV notifications.
      const hasTVData = Boolean(
        this.showId ||
          this.showTitle ||
          this.showPoster ||
          this.episodeId ||
          this.episodeTitle ||
          this.tvLogId ||
          this.showReviewId
      );

      if (hasTVData) {
        this.mediaType = "tv";
      } else if (
        this.mediaType === "none" &&
        hasMovieData
      ) {
        this.mediaType = "movie";
      }

      // Infer a navigation target for older routes that do not yet
      // send targetType explicitly.
      if (this.targetType === "none") {
        if (this.showReviewId) {
          this.targetType = "showReview";
        } else if (this.tvLogId) {
          this.targetType = "episodeReview";
        } else if (
          this.showId &&
          this.seasonNumber !== null &&
          this.episodeNumber !== null
        ) {
          this.targetType = "episode";
        } else if (this.showId) {
          this.targetType = "show";
        } else if (this.movieLogId || this.reviewId) {
          this.targetType = "movieReview";
        } else if (this.movieId) {
          this.targetType = "movie";
        } else if (this.listId) {
          this.targetType = "list";
        } else if (this.from && this.type === "follow") {
          this.targetType = "profile";
        } else if (this.targetUrl) {
          this.targetType = "externalUrl";
        }
      }

      // Keep read and readAt synchronized.
      if (this.read && !this.readAt) {
        this.readAt = new Date();
      }

      if (!this.read) {
        this.readAt = null;
      }

      // Protect against impossible Movie/TV combinations.
      if (
        this.mediaType === "movie" &&
        [
          "show",
          "showReview",
          "episode",
          "episodeReview",
        ].includes(this.targetType)
      ) {
        this.invalidate(
          "targetType",
          "A Movie notification cannot target TV content."
        );
      }

      if (
        this.mediaType === "tv" &&
        ["movie", "movieReview"].includes(
          this.targetType
        )
      ) {
        this.invalidate(
          "targetType",
          "A TV notification cannot target Movie content."
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  }
);

// ======================================================
// Helpful virtuals
// ======================================================

notificationSchema.virtual("requiresModeSwitch").get(
  function getRequiresModeSwitch() {
    return this.mediaType === "movie" ||
      this.mediaType === "tv"
      ? this.mediaType
      : null;
  }
);

notificationSchema.virtual("hasTVEpisodeTarget").get(
  function getHasTVEpisodeTarget() {
    return Boolean(
      this.showId &&
        this.seasonNumber !== null &&
        this.episodeNumber !== null
    );
  }
);

notificationSchema.set("toJSON", {
  virtuals: true,
});

notificationSchema.set("toObject", {
  virtuals: true,
});

// ======================================================
// Export
// ======================================================

module.exports =
  mongoose.models.Notification ||
  mongoose.model(
    "Notification",
    notificationSchema
  );