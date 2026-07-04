// src/models/log.js

const mongoose = require("mongoose");

const { Schema } = mongoose;

// ============================================================
// EMBEDDED REPLY SCHEMA
// ============================================================

const replySchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    text: {
      type: String,
      default: "",
      trim: true,
      maxlength: 5000,
    },

    gif: {
      type: String,
      default: "",
      trim: true,
    },

    image: {
      type: String,
      default: "",
      trim: true,
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },

    likes: {
      type: [
        {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
      ],
      default: [],
    },

    /*
     * Replies are embedded inside a Log document, so this stores
     * another embedded reply's ObjectId. It must not use ref: "Reply"
     * because no standalone Reply model exists.
     */
    parentComment: {
      type: Schema.Types.ObjectId,
      default: null,
    },
  },
  {
    _id: true,
    id: false,
  }
);

// ============================================================
// FAVORITE CHARACTER SCHEMA
// ============================================================

const favoriteCharacterSchema = new Schema(
  {
    characterId: {
      type: Number,
      default: null,
      min: 0,
    },

    actorId: {
      type: Number,
      default: null,
      min: 0,
    },

    characterName: {
      type: String,
      default: "",
      trim: true,
      maxlength: 300,
    },

    actorName: {
      type: String,
      default: "",
      trim: true,
      maxlength: 200,
    },

    profilePath: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    _id: false,
    id: false,
  }
);

// ============================================================
// MOVIE LOG SCHEMA
// ============================================================

const logSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /*
     * Optional reference to a locally cached Movie document.
     * tmdbId remains the canonical external movie identifier.
     */
    movie: {
      type: Schema.Types.ObjectId,
      ref: "Movie",
      default: null,
    },

    tmdbId: {
      type: Number,
      required: true,
      min: 1,
      index: true,
    },

    title: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },

    poster: {
      type: String,
      default: "",
      trim: true,
    },

    backdrop: {
      type: String,
      default: "",
      trim: true,
    },

    review: {
      type: String,
      default: "",
      trim: true,
      maxlength: 20000,
    },

    /*
     * Rating is optional because users may log a movie
     * without rating it.
     */
    rating: {
      type: Number,
      default: null,
      min: 0,
      max: 5,
    },

    rewatch: {
      type: Boolean,
      default: false,
    },

    rewatchCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    watchedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    gif: {
      type: String,
      default: "",
      trim: true,
    },

    image: {
      type: String,
      default: "",
      trim: true,
    },

    favoriteCharacter: {
      type: favoriteCharacterSchema,
      default: null,
    },

    replies: {
      type: [replySchema],
      default: [],
    },

    /*
     * Preserved for compatibility with any older top-level
     * comment/reply behavior. Like embedded parentComment,
     * this is an embedded reply ObjectId, not a model reference.
     */
    parentComment: {
      type: Schema.Types.ObjectId,
      default: null,
    },

    likes: {
      type: [
        {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
      ],
      default: [],
    },

    customBackdrop: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
    strict: true,
  }
);

// ============================================================
// INDEXES
// ============================================================

/*
 * User profile logs:
 * newest watched activity by one user.
 */
logSchema.index({
  user: 1,
  watchedAt: -1,
  createdAt: -1,
});

/*
 * Movie page activity:
 * newest logs for a particular TMDB movie.
 */
logSchema.index({
  tmdbId: 1,
  watchedAt: -1,
  createdAt: -1,
});

/*
 * Efficiently determine whether a user has watched a movie,
 * while still allowing multiple logs and rewatches.
 */
logSchema.index({
  user: 1,
  tmdbId: 1,
  watchedAt: -1,
});

/*
 * General feed and recent activity queries.
 */
logSchema.index({
  createdAt: -1,
});

/*
 * Used when locating an embedded reply for like, reply,
 * or delete operations.
 */
logSchema.index({
  "replies._id": 1,
});

// ============================================================
// VALIDATION AND NORMALIZATION
// ============================================================

logSchema.pre("validate", function normalizeLog(next) {
  try {
    const normalizedTmdbId = Number(this.tmdbId);

    if (
      Number.isInteger(normalizedTmdbId) &&
      normalizedTmdbId > 0
    ) {
      this.tmdbId = normalizedTmdbId;
    }

    if (
      this.rating === "" ||
      this.rating === undefined
    ) {
      this.rating = null;
    } else if (this.rating !== null) {
      const normalizedRating = Number(this.rating);

      if (Number.isFinite(normalizedRating)) {
        this.rating = normalizedRating;
      }
    }

    if (
      this.watchedAt &&
      !(this.watchedAt instanceof Date)
    ) {
      const normalizedWatchedAt = new Date(this.watchedAt);

      if (!Number.isNaN(normalizedWatchedAt.getTime())) {
        this.watchedAt = normalizedWatchedAt;
      }
    }

    const normalizedRewatchCount = Number(this.rewatchCount);

    if (
      Number.isInteger(normalizedRewatchCount) &&
      normalizedRewatchCount >= 0
    ) {
      this.rewatchCount = normalizedRewatchCount;
    } else {
      this.rewatchCount = 0;
    }

    if (this.rewatchCount > 0) {
      this.rewatch = true;
    }

    if (Array.isArray(this.likes)) {
      const seenLikes = new Set();

      this.likes = this.likes.filter((userId) => {
        if (!userId) {
          return false;
        }

        const key = String(userId);

        if (seenLikes.has(key)) {
          return false;
        }

        seenLikes.add(key);
        return true;
      });
    }

    if (Array.isArray(this.replies)) {
      for (const reply of this.replies) {
        if (!Array.isArray(reply.likes)) {
          reply.likes = [];
          continue;
        }

        const seenReplyLikes = new Set();

        reply.likes = reply.likes.filter((userId) => {
          if (!userId) {
            return false;
          }

          const key = String(userId);

          if (seenReplyLikes.has(key)) {
            return false;
          }

          seenReplyLikes.add(key);
          return true;
        });
      }
    }

    return next();
  } catch (error) {
    return next(error);
  }
});

// ============================================================
// MODEL
// ============================================================

module.exports =
  mongoose.models.Log ||
  mongoose.model("Log", logSchema);