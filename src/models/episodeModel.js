// src/models/episodeModel.js

const mongoose = require("mongoose");

const { Schema } = mongoose;

// ======================================================
// Embedded credit schemas
// ======================================================

const crewMemberSchema = new Schema(
  {
    // TMDB person ID.
    tmdbId: {
      type: Number,
      default: null,
    },

    // TMDB credit ID, when supplied.
    creditId: {
      type: String,
      default: "",
      trim: true,
    },

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

    job: {
      type: String,
      default: "",
      trim: true,
    },

    department: {
      type: String,
      default: "",
      trim: true,
    },

    profilePath: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    _id: false,
  }
);

const guestStarSchema = new Schema(
  {
    // TMDB person ID.
    tmdbId: {
      type: Number,
      default: null,
    },

    // TMDB credit ID, when supplied.
    creditId: {
      type: String,
      default: "",
      trim: true,
    },

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

    character: {
      type: String,
      default: "",
      trim: true,
    },

    characterAr: {
      type: String,
      default: "",
      trim: true,
    },

    order: {
      type: Number,
      default: 0,
      min: 0,
    },

    profilePath: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    _id: false,
  }
);

// ======================================================
// Episode schema
// ======================================================

const episodeSchema = new Schema(
  {
    // Optional local Scene references.
    // TMDB IDs remain the portable identity.
    show: {
      type: Schema.Types.ObjectId,
      ref: "Show",
      default: null,
      index: true,
    },

    season: {
      type: Schema.Types.ObjectId,
      ref: "Season",
      default: null,
      index: true,
    },

    // ==================================================
    // TMDB identity and episode position
    // ==================================================

    showTmdbId: {
      type: Number,
      required: true,
      index: true,
    },

    seasonTmdbId: {
      type: Number,
      default: null,
      index: true,
    },

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

    episodeNumber: {
      type: Number,
      required: true,
      min: 1,
    },

    // ==================================================
    // Episode content
    // ==================================================

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

    airDate: {
      type: Date,
      default: null,
      index: true,
    },

    runtime: {
      type: Number,
      default: null,
      min: 0,
    },

    stillPath: {
      type: String,
      default: "",
      trim: true,
    },

    productionCode: {
      type: String,
      default: "",
      trim: true,
    },

    // ==================================================
    // TMDB rating
    // ==================================================

    voteAverage: {
      type: Number,
      default: 0,
      min: 0,
      max: 10,
    },

    voteCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ==================================================
    // Episode-specific credits
    // ==================================================

    /**
     * Episode-specific crew from TMDB.
     *
     * The Episode page can use this for directors, writers,
     * cinematographers and other episode-specific roles.
     */
    crew: {
      type: [crewMemberSchema],
      default: [],
    },

    /**
     * Guest stars credited specifically for this episode.
     *
     * The complete favorite-character picker may combine these
     * guest stars with the show's regular cast.
     */
    guestStars: {
      type: [guestStarSchema],
      default: [],
    },

    // ==================================================
    // Synchronization
    // ==================================================

    lastSyncedAt: {
      type: Date,
      default: Date.now,
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

// A show can have only one episode at each season/episode position.
episodeSchema.index(
  {
    showTmdbId: 1,
    seasonNumber: 1,
    episodeNumber: 1,
  },
  {
    unique: true,
    name: "unique_show_episode_position",
  }
);

// Load an entire season in episode order.
episodeSchema.index({
  showTmdbId: 1,
  seasonNumber: 1,
  episodeNumber: 1,
});

// Load aired episodes for progress and season bulk-watch actions.
episodeSchema.index({
  showTmdbId: 1,
  seasonNumber: 1,
  airDate: 1,
  episodeNumber: 1,
});

// Find the next aired but unwatched episode.
episodeSchema.index({
  showTmdbId: 1,
  airDate: 1,
  seasonNumber: 1,
  episodeNumber: 1,
});

// Upcoming release and notification queries.
episodeSchema.index({
  airDate: 1,
  showTmdbId: 1,
  seasonNumber: 1,
  episodeNumber: 1,
});

// Resolve all episodes belonging to one TMDB season.
episodeSchema.index({
  seasonTmdbId: 1,
  episodeNumber: 1,
});

// Refresh stale cached episode data.
episodeSchema.index({
  lastSyncedAt: 1,
  showTmdbId: 1,
});

// ======================================================
// Validation and normalization
// ======================================================

episodeSchema.pre("validate", function normalizeEpisode(next) {
  try {
    const trimFields = [
      "name",
      "nameAr",
      "overview",
      "overviewAr",
      "stillPath",
      "productionCode",
    ];

    for (const field of trimFields) {
      if (typeof this[field] === "string") {
        this[field] = this[field].trim();
      }
    }

    if (
      this.runtime !== null &&
      this.runtime !== undefined &&
      (!Number.isFinite(this.runtime) || this.runtime < 0)
    ) {
      this.runtime = null;
    }

    if (
      !Number.isFinite(this.voteAverage) ||
      this.voteAverage < 0
    ) {
      this.voteAverage = 0;
    }

    if (this.voteAverage > 10) {
      this.voteAverage = 10;
    }

    if (
      !Number.isFinite(this.voteCount) ||
      this.voteCount < 0
    ) {
      this.voteCount = 0;
    }

    // Remove duplicate crew credits.
    if (Array.isArray(this.crew)) {
      const seenCrew = new Set();

      this.crew = this.crew.filter((member) => {
        const key =
          member.creditId ||
          `${member.tmdbId || "unknown"}:${member.job || ""}`;

        if (seenCrew.has(key)) {
          return false;
        }

        seenCrew.add(key);
        return true;
      });
    }

    // Remove duplicate guest-star credits and preserve display order.
    if (Array.isArray(this.guestStars)) {
      const seenGuests = new Set();

      this.guestStars = this.guestStars
        .filter((guest) => {
          const key =
            guest.creditId ||
            `${guest.tmdbId || "unknown"}:${guest.character || ""}`;

          if (seenGuests.has(key)) {
            return false;
          }

          seenGuests.add(key);
          return true;
        })
        .sort((a, b) => {
          const orderA = Number.isFinite(a.order) ? a.order : 0;
          const orderB = Number.isFinite(b.order) ? b.order : 0;

          return orderA - orderB;
        });
    }

    next();
  } catch (error) {
    next(error);
  }
});

// ======================================================
// Helpful virtuals
// ======================================================

episodeSchema.virtual("isSpecial").get(function getIsSpecial() {
  return this.seasonNumber === 0;
});

episodeSchema.virtual("isAired").get(function getIsAired() {
  if (!this.airDate) {
    return false;
  }

  return new Date(this.airDate).getTime() <= Date.now();
});

episodeSchema.virtual("year").get(function getYear() {
  if (!this.airDate) {
    return null;
  }

  return new Date(this.airDate).getUTCFullYear();
});

episodeSchema.virtual("episodeCode").get(function getEpisodeCode() {
  return `S${this.seasonNumber} E${this.episodeNumber}`;
});

episodeSchema.virtual("displayName").get(function getDisplayName() {
  return this.name || `Episode ${this.episodeNumber}`;
});

episodeSchema.set("toJSON", {
  virtuals: true,
});

episodeSchema.set("toObject", {
  virtuals: true,
});

// ======================================================
// Export
// ======================================================

module.exports =
  mongoose.models.Episode ||
  mongoose.model("Episode", episodeSchema);

  