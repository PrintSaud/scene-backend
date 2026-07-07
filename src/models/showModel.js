// src/models/showModel.js

const mongoose = require("mongoose");

const { Schema } = mongoose;

// ======================================================
// Reusable embedded schemas
// ======================================================

const networkSchema = new Schema(
  {
    tmdbId: {
      type: Number,
      default: null,
    },

    name: {
      type: String,
      default: "",
      trim: true,
    },

    logoPath: {
      type: String,
      default: "",
      trim: true,
    },

    originCountry: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    _id: false,
  }
);

const creatorSchema = new Schema(
  {
    tmdbId: {
      type: Number,
      default: null,
    },

    name: {
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

const productionCompanySchema = new Schema(
  {
    tmdbId: {
      type: Number,
      default: null,
    },

    name: {
      type: String,
      default: "",
      trim: true,
    },

    logoPath: {
      type: String,
      default: "",
      trim: true,
    },

    originCountry: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    _id: false,
  }
);

const languageSchema = new Schema(
  {
    iso6391: {
      type: String,
      default: "",
      trim: true,
    },

    englishName: {
      type: String,
      default: "",
      trim: true,
    },

    name: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    _id: false,
  }
);

const episodeSummarySchema = new Schema(
  {
    tmdbId: {
      type: Number,
      default: null,
    },

    name: {
      type: String,
      default: "",
      trim: true,
    },

    overview: {
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

    airDate: {
      type: Date,
      default: null,
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
  },
  {
    _id: false,
  }
);

// ======================================================
// Show schema
// ======================================================

const showSchema = new Schema(
  {
    // ==================================================
    // TMDB identity
    // ==================================================

    tmdbId: {
      type: Number,
      required: true,
      unique: true,
    },

    // ==================================================
    // Titles and localization
    // ==================================================

    name: {
      type: String,
      required: true,
      trim: true,
    },

    originalName: {
      type: String,
      default: "",
      trim: true,
    },

    // Arabic/localized title resolved from TMDB translations.
    nameAr: {
      type: String,
      default: "",
      trim: true,
    },

    // Additional names useful for Scene search.
    searchAliases: {
      type: [String],
      default: [],
    },

    tagline: {
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

    // ==================================================
    // Artwork
    // ==================================================

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

    // ==================================================
    // Release and lifecycle information
    // ==================================================

    firstAirDate: {
      type: Date,
      default: null,
      index: true,
    },

    lastAirDate: {
      type: Date,
      default: null,
    },

    status: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    type: {
      type: String,
      default: "",
      trim: true,
    },

    inProduction: {
      type: Boolean,
      default: false,
      index: true,
    },

    adult: {
      type: Boolean,
      default: false,
    },

    // ==================================================
    // Language and regional information
    // ==================================================

    originalLanguage: {
      type: String,
      default: "",
      trim: true,
    },

    originCountry: {
      type: [String],
      default: [],
    },

    spokenLanguages: {
      type: [languageSchema],
      default: [],
    },

    // ==================================================
    // Genres and discovery
    // ==================================================

    genres: {
      type: [String],
      default: [],
    },

    genreIds: {
      type: [Number],
      default: [],
    },

    keywords: {
      type: [String],
      default: [],
    },

    // ==================================================
    // Companies, networks and creators
    // ==================================================

    networks: {
      type: [networkSchema],
      default: [],
    },

    creators: {
      type: [creatorSchema],
      default: [],
    },

    productionCompanies: {
      type: [productionCompanySchema],
      default: [],
    },

    // ==================================================
    // Season and episode totals
    // ==================================================

    /**
     * TMDB's complete season count.
     *
     * This may include seasons containing future episodes and may include
     * Season 0 depending on TMDB's response.
     *
     * Do not use this field alone for Scene progress calculations.
     */
    numberOfSeasons: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * TMDB's complete episode count.
     *
     * This may include episodes that have not aired yet.
     *
     * Scene progress must instead use airedEpisodeCount or Episode documents.
     */
    numberOfEpisodes: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * Cached count of currently aired normal episodes.
     *
     * Season 0 specials are excluded by default.
     * Episode documents remain the source of truth.
     */
    airedEpisodeCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * Cached count of seasons with at least one aired normal episode.
     *
     * Season 0 is excluded by default.
     */
    airedSeasonCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * Timestamp for the most recent recomputation of airedEpisodeCount
     * and airedSeasonCount from Scene's season/episode metadata.
     */
    progressMetadataSyncedAt: {
      type: Date,
      default: null,
      index: true,
    },

    // ==================================================
    // Runtime
    // ==================================================

    episodeRunTime: {
      type: [Number],
      default: [],
    },

    averageRuntime: {
      type: Number,
      default: null,
      min: 0,
    },

    // ==================================================
    // Episode summaries
    // ==================================================

    lastEpisodeToAir: {
      type: episodeSummarySchema,
      default: null,
    },

    nextEpisodeToAir: {
      type: episodeSummarySchema,
      default: null,
    },

    // ==================================================
    // TMDB popularity and rating
    // ==================================================

    popularity: {
      type: Number,
      default: 0,
      index: true,
    },

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
    // External information
    // ==================================================

    homepage: {
      type: String,
      default: "",
      trim: true,
    },

    externalIds: {
      imdbId: {
        type: String,
        default: "",
        trim: true,
      },

      tvdbId: {
        type: Number,
        default: null,
      },

      wikidataId: {
        type: String,
        default: "",
        trim: true,
      },
    },

    // ==================================================
    // Synchronization
    // ==================================================

    /**
     * The most recent time Scene refreshed the main show details
     * from TMDB.
     */
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

// Bilingual show search.
showSchema.index(
  {
    name: "text",
    originalName: "text",
    nameAr: "text",
    searchAliases: "text",
  },
  {
    name: "show_text_search",
    weights: {
      name: 10,
      nameAr: 10,
      originalName: 7,
      searchAliases: 5,
    },
  }
);

// Trending and discovery.
showSchema.index({
  popularity: -1,
  voteCount: -1,
});

showSchema.index({
  firstAirDate: -1,
  popularity: -1,
});

// Currently airing/in-production discovery.
showSchema.index({
  inProduction: 1,
  status: 1,
  popularity: -1,
});

// Genre-filtered discovery.
showSchema.index({
  genreIds: 1,
  popularity: -1,
});

// Stale TMDB-cache refreshes.
showSchema.index({
  lastSyncedAt: 1,
  popularity: -1,
});

// ======================================================
// Validation and normalization
// ======================================================

showSchema.pre("validate", function normalizeShow(next) {
  try {
    const trimFields = [
      "name",
      "originalName",
      "nameAr",
      "tagline",
      "overview",
      "overviewAr",
      "posterPath",
      "backdropPath",
      "status",
      "type",
      "originalLanguage",
      "homepage",
    ];

    for (const field of trimFields) {
      if (typeof this[field] === "string") {
        this[field] = this[field].trim();
      }
    }

    if (this.externalIds) {
      const externalStringFields = ["imdbId", "wikidataId"];

      for (const field of externalStringFields) {
        if (typeof this.externalIds[field] === "string") {
          this.externalIds[field] = this.externalIds[field].trim();
        }
      }
    }

    const normalizeStringArray = (values) => {
      if (!Array.isArray(values)) {
        return [];
      }

      return [
        ...new Set(
          values
            .filter((value) => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean)
        ),
      ];
    };

    const normalizeNumberArray = (values) => {
      if (!Array.isArray(values)) {
        return [];
      }

      return [
        ...new Set(
          values.filter(
            (value) =>
              typeof value === "number" &&
              Number.isFinite(value)
          )
        ),
      ];
    };

    this.searchAliases = normalizeStringArray(this.searchAliases);
    this.originCountry = normalizeStringArray(this.originCountry);
    this.genres = normalizeStringArray(this.genres);
    this.keywords = normalizeStringArray(this.keywords);
    this.genreIds = normalizeNumberArray(this.genreIds);

    if (Array.isArray(this.episodeRunTime)) {
      this.episodeRunTime = [
        ...new Set(
          this.episodeRunTime.filter(
            (runtime) =>
              typeof runtime === "number" &&
              Number.isFinite(runtime) &&
              runtime > 0
          )
        ),
      ];

      if (
        this.episodeRunTime.length > 0 &&
        (!this.averageRuntime || this.averageRuntime <= 0)
      ) {
        const runtimeTotal = this.episodeRunTime.reduce(
          (total, runtime) => total + runtime,
          0
        );

        this.averageRuntime = Math.round(
          runtimeTotal / this.episodeRunTime.length
        );
      }
    }

    if (
      this.averageRuntime !== null &&
      (!Number.isFinite(this.averageRuntime) ||
        this.averageRuntime < 0)
    ) {
      this.averageRuntime = null;
    }

    if (
      !Number.isFinite(this.airedEpisodeCount) ||
      this.airedEpisodeCount < 0
    ) {
      this.airedEpisodeCount = 0;
    }

    if (
      !Number.isFinite(this.airedSeasonCount) ||
      this.airedSeasonCount < 0
    ) {
      this.airedSeasonCount = 0;
    }

    next();
  } catch (error) {
    next(error);
  }
});

// ======================================================
// Helpful virtuals
// ======================================================

showSchema.virtual("year").get(function getYear() {
  if (!this.firstAirDate) {
    return null;
  }

  return new Date(this.firstAirDate).getUTCFullYear();
});

showSchema.virtual("displayName").get(function getDisplayName() {
  return this.name || this.originalName || "";
});

showSchema.virtual("hasUpcomingEpisode").get(
  function getHasUpcomingEpisode() {
    return Boolean(
      this.nextEpisodeToAir &&
        this.nextEpisodeToAir.seasonNumber !== null &&
        this.nextEpisodeToAir.episodeNumber !== null
    );
  }
);

showSchema.set("toJSON", {
  virtuals: true,
});

showSchema.set("toObject", {
  virtuals: true,
});

// ======================================================
// Export
// ======================================================

module.exports =
  mongoose.models.Show ||
  mongoose.model("Show", showSchema);