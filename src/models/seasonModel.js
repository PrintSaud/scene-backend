// src/models/seasonModel.js

const mongoose = require("mongoose");

const { Schema } = mongoose;

const seasonSchema = new Schema(
  {
    // Optional local Scene Show reference.
    // showTmdbId remains the stable external identity.
    show: {
      type: Schema.Types.ObjectId,
      ref: "Show",
      default: null,
      index: true,
    },

    showTmdbId: {
      type: Number,
      required: true,
      index: true,
    },

    // TMDB's unique ID for this season.
    tmdbId: {
      type: Number,
      required: true,
      unique: true,
    },

    seasonNumber: {
      type: Number,
      required: true,
      min: 0,
    },

    // =========================
    // Season details
    // =========================

    name: {
      type: String,
      default: "",
      trim: true,
    },

    nameAr: {
      type: String,
      default: "",
      trim: true,
    },

    overview: {
      type: String,
      default: "",
      trim: true,
    },

    overviewAr: {
      type: String,
      default: "",
      trim: true,
    },

    posterPath: {
      type: String,
      default: "",
      trim: true,
    },

    airDate: {
      type: Date,
      default: null,
      index: true,
    },

    // =========================
    // Episode totals
    // =========================

    /**
     * Total number of episodes TMDB currently associates
     * with this season, including future episodes.
     */
    episodeCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * Number of episodes whose air date has passed.
     *
     * This is the denominator for season progress and the
     * maximum number eligible for bulk season logging.
     */
    airedEpisodeCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * Total runtime of currently aired episodes.
     *
     * This can help with statistics and season summaries,
     * but Episode documents remain the source of truth.
     */
    airedRuntimeMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },

    // =========================
    // TMDB rating
    // =========================

    voteAverage: {
      type: Number,
      default: 0,
      min: 0,
      max: 10,
    },

    // =========================
    // Synchronization
    // =========================

    lastSyncedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    /**
     * When Scene last recalculated airedEpisodeCount and
     * airedRuntimeMinutes from the Episode collection.
     */
    progressMetadataSyncedAt: {
      type: Date,
      default: null,
      index: true,
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

// A show can only have one document for each season number.
seasonSchema.index(
  {
    showTmdbId: 1,
    seasonNumber: 1,
  },
  {
    unique: true,
    name: "unique_show_season",
  }
);

// Fetch every season for a Show page in the correct order.
seasonSchema.index({
  showTmdbId: 1,
  seasonNumber: 1,
  airDate: 1,
});

// Find stale season metadata that needs refreshing.
seasonSchema.index({
  lastSyncedAt: 1,
  showTmdbId: 1,
});


// ======================================================
// Validation and normalization
// ======================================================

seasonSchema.pre("validate", function normalizeSeason(next) {
  try {
    const trimFields = [
      "name",
      "nameAr",
      "overview",
      "overviewAr",
      "posterPath",
    ];

    for (const field of trimFields) {
      if (typeof this[field] === "string") {
        this[field] = this[field].trim();
      }
    }

    if (
      !Number.isFinite(this.episodeCount) ||
      this.episodeCount < 0
    ) {
      this.episodeCount = 0;
    }

    if (
      !Number.isFinite(this.airedEpisodeCount) ||
      this.airedEpisodeCount < 0
    ) {
      this.airedEpisodeCount = 0;
    }

    if (
      !Number.isFinite(this.airedRuntimeMinutes) ||
      this.airedRuntimeMinutes < 0
    ) {
      this.airedRuntimeMinutes = 0;
    }

    // The aired count should never exceed the season's total.
    if (
      this.episodeCount > 0 &&
      this.airedEpisodeCount > this.episodeCount
    ) {
      this.airedEpisodeCount = this.episodeCount;
    }

    next();
  } catch (error) {
    next(error);
  }
});

// ======================================================
// Helpful virtuals
// ======================================================

seasonSchema.virtual("isSpecialsSeason").get(
  function getIsSpecialsSeason() {
    return this.seasonNumber === 0;
  }
);

seasonSchema.virtual("hasAiredEpisodes").get(
  function getHasAiredEpisodes() {
    return this.airedEpisodeCount > 0;
  }
);

seasonSchema.virtual("hasFutureEpisodes").get(
  function getHasFutureEpisodes() {
    return this.episodeCount > this.airedEpisodeCount;
  }
);

seasonSchema.set("toJSON", {
  virtuals: true,
});

seasonSchema.set("toObject", {
  virtuals: true,
});

// ======================================================
// Export
// ======================================================

module.exports =
  mongoose.models.Season ||
  mongoose.model("Season", seasonSchema);