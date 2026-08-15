// src/models/userShowProgress.js

const mongoose = require("mongoose");

const { Schema } = mongoose;

// ======================================================
// Next episode snapshot
// ======================================================

const nextEpisodeSchema = new Schema(
  {
    episodeTmdbId: {
      type: Number,
      default: null,
    },

    seasonNumber: {
      type: Number,
      default: null,
      min: 1,
    },

    episodeNumber: {
      type: Number,
      default: null,
      min: 1,
    },

    name: {
      type: String,
      default: "",
      trim: true,
    },

    stillPath: {
      type: String,
      default: "",
      trim: true,
    },

    airDate: {
      type: Date,
      default: null,
    },

    runtime: {
      type: Number,
      default: null,
      min: 0,
    },
  },
  {
    _id: false,
  },
);

// ======================================================
// User show progress schema
// ======================================================

const userShowProgressSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Optional local cached Show reference.
    show: {
      type: Schema.Types.ObjectId,
      ref: "Show",
      default: null,
      index: true,
    },

    // ==================================================
    // Show identity snapshot
    // ==================================================

    showTmdbId: {
      type: Number,
      required: true,
      index: true,
    },

    showName: {
      type: String,
      required: true,
      trim: true,
    },

    showNameAr: {
      type: String,
      default: "",
      trim: true,
    },

    posterPath: {
      type: String,
      default: "",
      trim: true,
    },

    backdropPath: {
      type: String,
      default: "",
      trim: true,
    },

    firstAirDate: {
      type: Date,
      default: null,
    },

    // ==================================================
    // Unique progress
    // ==================================================

    /**
     * A progress document exists only after the user has watched
     * at least one episode.
     *
     * completed means the user has watched every currently aired
     * regular episode. Future episodes do not count yet.
     */
    status: {
      type: String,
      enum: ["watching", "completed"],
      default: "watching",
      index: true,
    },

    /**
     * Number of unique watched episodes from Seasons 1+.
     *
     * Rewatches do not increase this value.
     */
    watchedEpisodeCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * Number of unique watched Season 0 episodes.
     *
     * Specials do not count toward normal show completion.
     */
    watchedSpecialCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * Number of currently aired regular episodes.
     *
     * Informational and useful for release-aware experiences.
     */
    airedEpisodeCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * All known regular episodes, including future episodes.
     *
     * This is the denominator used for full-series progress.
     */
    totalEpisodeCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    progressPercentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    /**
     * Number of regular seasons for which the user has watched
     * every currently aired episode.
     */
    completedSeasonCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * Number of regular seasons containing at least one aired
     * episode.
     */
    airedSeasonCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ==================================================
    // Watch and rewatch statistics
    // ==================================================

    /**
     * Every TVLog for this show, including rewatches.
     *
     * Watching the same episode 33 times counts as 33 watches.
     */
    totalWatchCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * Additional watches after the first watch of each episode.
     */
    rewatchCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * Runtime of all watches and rewatches combined.
     *
     * Stored in minutes.
     */
    totalWatchMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ==================================================
    // Latest watched episode
    // ==================================================

    lastWatchedAt: {
      type: Date,
      default: null,
      index: true,
    },

    lastLog: {
      type: Schema.Types.ObjectId,
      ref: "TVLog",
      default: null,
    },

    lastSeasonNumber: {
      type: Number,
      default: null,
      min: 0,
    },

    lastEpisodeNumber: {
      type: Number,
      default: null,
      min: 1,
    },

    lastEpisodeTmdbId: {
      type: Number,
      default: null,
    },

    lastEpisodeName: {
      type: String,
      default: "",
      trim: true,
    },

    lastEpisodeStillPath: {
      type: String,
      default: "",
      trim: true,
    },

    lastWatchNumber: {
      type: Number,
      default: 1,
      min: 1,
    },

    lastWasRewatch: {
      type: Boolean,
      default: false,
    },

    // ==================================================
    // Upcoming Episodes tab
    // ==================================================

    /**
     * The earliest currently aired regular episode that the user
     * has not watched.
     *
     * null means the user is caught up with all aired episodes.
     */
    nextUnwatchedEpisode: {
      type: nextEpisodeSchema,
      default: null,
    },

    /**
     * Chronological episode after the user's latest episode log
     * when they are rewatching an already-completed show.
     *
     * This is intentionally separate from nextUnwatchedEpisode:
     * progress can remain 100% while Continue Watching follows
     * the user's current rewatch position.
     */
    nextEpisodeAfterLatestLog: {
      type: nextEpisodeSchema,
      default: null,
    },

    /**
     * True when every currently aired regular episode has been
     * watched.
     *
     * The show may still be in production and have future episodes.
     */
    isCaughtUp: {
      type: Boolean,
      default: false,
      index: true,
    },

    /**
     * Future episode information shown after the user has caught up.
     *
     * This episode cannot be marked watched before it airs.
     */
    nextScheduledEpisode: {
      type: nextEpisodeSchema,
      default: null,
    },

    // ==================================================
    // Milestone dates
    // ==================================================

    startedAt: {
      type: Date,
      default: null,
    },

    /**
     * Preserves the first time the user reached 100% of all
     * currently aired regular episodes.
     *
     * It remains preserved if a future episode later causes the
     * progress percentage to fall below 100%.
     */
    firstCompletedAt: {
      type: Date,
      default: null,
    },

    /**
     * Most recent time this summary was rebuilt from TVLog and
     * Episode documents.
     */
    lastCalculatedAt: {
      type: Date,
      default: Date.now,
    },

    /**
     * Most recent time the show and episode metadata used by this
     * progress document was refreshed.
     */
    metadataLastSyncedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    minimize: false,
  },
);

// ======================================================
// Indexes
// ======================================================

// Exactly one progress summary for each user/show combination.
userShowProgressSchema.index(
  {
    user: 1,
    showTmdbId: 1,
  },
  {
    unique: true,
    name: "unique_user_show_progress",
  },
);

// TV profile Shows tab and recent activity ordering.
userShowProgressSchema.index({
  user: 1,
  lastWatchedAt: -1,
});

// Watching/completed filters.
userShowProgressSchema.index({
  user: 1,
  status: 1,
  lastWatchedAt: -1,
});

// Upcoming Episodes:
// started incomplete shows, most recently watched first.
userShowProgressSchema.index({
  user: 1,
  isCaughtUp: 1,
  lastWatchedAt: -1,
});

// Completed-show count in the TV profile header.
userShowProgressSchema.index({
  user: 1,
  status: 1,
});

// Friends’ show progress.
userShowProgressSchema.index({
  showTmdbId: 1,
  progressPercentage: -1,
  lastWatchedAt: -1,
});

// Stale progress summaries needing recalculation.
userShowProgressSchema.index({
  lastCalculatedAt: 1,
});

// ======================================================
// Validation and derived values
// ======================================================

userShowProgressSchema.pre(
  "validate",
  function normalizeUserShowProgress(next) {
    try {
      const trimFields = [
        "showName",
        "showNameAr",
        "posterPath",
        "backdropPath",
        "lastEpisodeName",
        "lastEpisodeStillPath",
      ];

      for (const field of trimFields) {
        if (typeof this[field] === "string") {
          this[field] = this[field].trim();
        }
      }

      const normalizeCount = (value) => {
        const count = Number(value);

        if (!Number.isFinite(count) || count < 0) {
          return 0;
        }

        return Math.floor(count);
      };

      this.watchedEpisodeCount = normalizeCount(this.watchedEpisodeCount);

      this.watchedSpecialCount = normalizeCount(this.watchedSpecialCount);

      this.airedEpisodeCount = normalizeCount(this.airedEpisodeCount);

      this.totalEpisodeCount = normalizeCount(this.totalEpisodeCount);

      this.completedSeasonCount = normalizeCount(this.completedSeasonCount);

      this.airedSeasonCount = normalizeCount(this.airedSeasonCount);

      this.totalWatchCount = normalizeCount(this.totalWatchCount);

      this.rewatchCount = normalizeCount(this.rewatchCount);

      this.totalWatchMinutes = normalizeCount(this.totalWatchMinutes);

      if (
        this.totalEpisodeCount > 0 &&
        this.airedEpisodeCount > this.totalEpisodeCount
      ) {
        this.airedEpisodeCount = this.totalEpisodeCount;
      }

      if (
        this.totalEpisodeCount > 0 &&
        this.watchedEpisodeCount > this.totalEpisodeCount
      ) {
        this.watchedEpisodeCount = this.totalEpisodeCount;
      }

      if (
        this.airedSeasonCount > 0 &&
        this.completedSeasonCount > this.airedSeasonCount
      ) {
        this.completedSeasonCount = this.airedSeasonCount;
      }

      if (this.rewatchCount > this.totalWatchCount) {
        this.rewatchCount = this.totalWatchCount;
      }

      if (!Number.isInteger(this.lastWatchNumber) || this.lastWatchNumber < 1) {
        this.lastWatchNumber = 1;
      }

      this.lastWasRewatch = this.lastWatchNumber > 1;

      if (this.totalEpisodeCount > 0) {
        this.progressPercentage = Math.min(
          100,
          Math.round((this.watchedEpisodeCount / this.totalEpisodeCount) * 100),
        );
      } else {
        this.progressPercentage = 0;
      }

      const isCompleted =
        this.totalEpisodeCount > 0 &&
        this.watchedEpisodeCount >= this.totalEpisodeCount;

      this.status = isCompleted ? "completed" : "watching";

      this.isCaughtUp = isCompleted;

      if (isCompleted && !this.firstCompletedAt) {
        this.firstCompletedAt = new Date();
      }

      if (this.watchedEpisodeCount > 0 && !this.startedAt) {
        this.startedAt = this.lastWatchedAt || new Date();
      }

      // A caught-up show cannot have an aired next-unwatched episode.
      if (this.isCaughtUp) {
        this.nextUnwatchedEpisode = null;
      }

      this.lastCalculatedAt = new Date();

      next();
    } catch (error) {
      next(error);
    }
  },
);

// ======================================================
// Helpful virtuals
// ======================================================

userShowProgressSchema.virtual("hasStarted").get(function getHasStarted() {
  return this.watchedEpisodeCount > 0;
});

userShowProgressSchema
  .virtual("uniqueEpisodeCount")
  .get(function getUniqueEpisodeCount() {
    return this.watchedEpisodeCount + this.watchedSpecialCount;
  });

userShowProgressSchema
  .virtual("remainingEpisodeCount")
  .get(function getRemainingEpisodeCount() {
    return Math.max(0, this.totalEpisodeCount - this.watchedEpisodeCount);
  });

userShowProgressSchema.set("toJSON", {
  virtuals: true,
});

userShowProgressSchema.set("toObject", {
  virtuals: true,
});

// ======================================================
// Export
// ======================================================

module.exports =
  mongoose.models.UserShowProgress ||
  mongoose.model("UserShowProgress", userShowProgressSchema);
