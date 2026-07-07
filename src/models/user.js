// src/models/user.js

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const { Schema } = mongoose;

// ======================================================
// Shared embedded schemas
// ======================================================

const genreSchema = new Schema(
  {
    id: {
      type: Number,
      default: null,
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

const movieWatchlistItemSchema = new Schema(
  {
    tmdbId: {
      type: Number,
      required: true,
      min: 1,
    },

    title: {
      type: String,
      default: "",
      trim: true,
    },

    // Current normalized field.
    posterPath: {
      type: String,
      default: "",
      trim: true,
    },

    // Preserved for existing clients and routes.
    poster_path: {
      type: String,
      default: "",
      trim: true,
    },

    backdropPath: {
      type: String,
      default: "",
      trim: true,
    },

    release_date: {
      type: String,
      default: "",
      trim: true,
    },

    runtime: {
      type: Number,
      default: null,
      min: 0,
    },

    vote_average: {
      type: Number,
      default: null,
      min: 0,
      max: 10,
    },

    genres: {
      type: [genreSchema],
      default: [],
    },

    addedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: true,
  }
);

const favoriteFilmSchema = new Schema(
  {
    tmdbId: {
      type: Number,
      required: true,
      min: 1,
    },

    title: {
      type: String,
      default: "",
      trim: true,
    },

    titleAr: {
      type: String,
      default: "",
      trim: true,
    },

    // Existing frontend field.
    poster_path: {
      type: String,
      default: "",
      trim: true,
    },

    backdropPath: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    _id: true,
  }
);

const tvWatchlistItemSchema = new Schema(
  {
    tmdbId: {
      type: Number,
      required: true,
      min: 1,
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

    originalName: {
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
      type: String,
      default: "",
      trim: true,
    },

    status: {
      type: String,
      default: "",
      trim: true,
    },

    voteAverage: {
      type: Number,
      default: null,
      min: 0,
      max: 10,
    },

    genres: {
      type: [genreSchema],
      default: [],
    },

    addedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: true,
  }
);

const favoriteShowSchema = new Schema(
  {
    tmdbId: {
      type: Number,
      required: true,
      min: 1,
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

    originalName: {
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
  },
  {
    _id: true,
  }
);

const deviceTokenSchema = new Schema(
  {
    token: {
      type: String,
      required: true,
      trim: true,
    },

    provider: {
      type: String,
      default: "fcm",
      trim: true,
    },

    platform: {
      type: String,
      enum: ["ios", "android", "unknown"],
      default: "unknown",
    },

    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: true,
  }
);

// ======================================================
// User schema
// ======================================================

const UserSchema = new Schema(
  {
    googleId: {
      type: String,
      default: null,
      trim: true,
    },

    /**
     * Existing usernames remain case-preserving.
     *
     * Whitespace is removed before saving.
     */
    username: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      lowercase: true,
    },

    name: {
      type: String,
      default: "",
      trim: true,
    },

    emailVerified: {
      type: Boolean,

      // Existing accounts predate this field.
      // New registration routes should explicitly set false.
      default: true,
      index: true,
    },

    password: {
      type: String,
      required: function requirePassword() {
        return !this.googleId;
      },
    },

    bio: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },

    language: {
      type: String,
      enum: ["en", "ar"],
      default: "en",
    },

    avatar: {
      type: String,
      default: "",
      trim: true,
    },

    // ==================================================
    // Scene mode
    // ==================================================

    /**
     * Shared active mode used by:
     * - Home
     * - Profile
     * - Notifications
     */
    preferredMode: {
      type: String,
      enum: ["movies", "tv"],
      default: "movies",
      index: true,
    },

    // ==================================================
    // Movie profile
    // ==================================================

    watchlist: {
      type: [movieWatchlistItemSchema],
      default: [],
    },

    // Existing lightweight favorite Movie IDs.
    favorites: {
      type: [Number],
      default: [],
    },

    // Movie Top Four.
    favoriteFilms: {
      type: [favoriteFilmSchema],
      default: [],
      validate: {
        validator(films) {
          return Array.isArray(films) && films.length <= 4;
        },
        message:
          "A user can have no more than four favorite films.",
      },
    },

    customPosters: {
      type: Map,
      of: String,
      default: {},
    },

    profileBackdrop: {
      type: String,
      default: "",
      trim: true,
    },

    favoriteCharacter: {
      type: String,
      default: "",
      trim: true,
    },

    favoriteActor: {
      type: String,
      default: "",
      trim: true,
    },

    topMovies: {
      type: [String],
      default: [],
    },

    totalLogs: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ==================================================
    // Scene TV profile
    // ==================================================

    /**
     * Saved show watchlist.
     *
     * Upcoming Episodes does not live in this array.
     * It is derived from UserShowProgress.
     */
    tvWatchlist: {
      type: [tvWatchlistItemSchema],
      default: [],
    },

    /**
     * TV Top Four.
     *
     * Array order is the profile display order.
     */
    favoriteShows: {
      type: [favoriteShowSchema],
      default: [],
      validate: {
        validator(shows) {
          return Array.isArray(shows) && shows.length <= 4;
        },
        message:
          "A user can have no more than four favorite shows.",
      },
    },

    /**
     * TV-specific profile backdrop.
     *
     * Edit Profile should only allow show-related images here.
     */
    tvProfileBackdrop: {
      type: String,
      default: "",
      trim: true,
    },

    // ==================================================
    // Cached global TV statistics
    // ==================================================

    /**
     * Every TVLog belonging to this user.
     *
     * Rewatches are included.
     */
    totalEpisodeWatches: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * Number of unique regular episodes watched.
     *
     * Rewatches do not increase this value.
     */
    totalUniqueEpisodesWatched: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * Every watch after the first watch of an episode.
     */
    totalEpisodeRewatches: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * Runtime of every watch and rewatch combined.
     *
     * Stored in minutes.
     */
    totalTVWatchMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * Number of regular seasons completed against currently
     * aired episodes.
     */
    totalSeasonsCompleted: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * Shows with at least one watched episode.
     */
    totalShowsStarted: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * Shows where every currently aired regular episode is watched.
     */
    totalShowsCompleted: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * Last time the global TV counters above were rebuilt.
     */
    tvStatsCalculatedAt: {
      type: Date,
      default: null,
      index: true,
    },

    tvImportStatus: {
      hasImported: {
        type: Boolean,
        default: false,
      },

      lastImportedAt: {
        type: Date,
        default: null,
      },

      latestImportJob: {
        type: Schema.Types.ObjectId,
        ref: "TVImportJob",
        default: null,
      },
    },

    // ==================================================
    // Social graph
    // ==================================================

    following: {
      type: [Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },

    followers: {
      type: [Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },

    noNewFollowers: {
      type: Boolean,
      default: false,
    },

    socials: {
      X: {
        type: String,
        default: "",
        trim: true,
      },

      youtube: {
        type: String,
        default: "",
        trim: true,
      },

      instagram: {
        type: String,
        default: "",
        trim: true,
      },

      tiktok: {
        type: String,
        default: "",
        trim: true,
      },

      imdb: {
        type: String,
        default: "",
        trim: true,
      },

      tmdb: {
        type: String,
        default: "",
        trim: true,
      },

      website: {
        type: String,
        default: "",
        trim: true,
      },
    },

    recentGifs: {
      type: [String],
      default: [],
    },

    // ==================================================
    // Password reset and email verification
    // ==================================================

    resetCode: {
      type: String,
      default: null,
    },

    resetCodeExpires: {
      type: Date,
      default: null,
    },

    verificationCode: {
      type: String,
      default: null,
    },

    verificationCodeExpires: {
      type: Date,
      default: null,
    },

    // ==================================================
    // Push notifications
    // ==================================================

    deviceTokens: {
      type: [deviceTokenSchema],
      default: [],
    },

    pushSettings: {
      muteAll: {
        type: Boolean,
        default: false,
      },

      muteFollow: {
        type: Boolean,
        default: false,
      },

      muteReplies: {
        type: Boolean,
        default: false,
      },

      muteLikes: {
        type: Boolean,
        default: false,
      },

      muteNewEpisodes: {
        type: Boolean,
        default: false,
      },

      muteSeasonPremieres: {
        type: Boolean,
        default: false,
      },

      muteShowActivity: {
        type: Boolean,
        default: false,
      },
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

UserSchema.index(
  {
    googleId: 1,
  },
  {
    sparse: true,
  }
);

UserSchema.index({
  "deviceTokens.token": 1,
});

UserSchema.index({
  createdAt: -1,
});

UserSchema.index({
  preferredMode: 1,
  createdAt: -1,
});

// ======================================================
// Cleanup helpers
// ======================================================

function trimValue(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function normalizeNonNegativeInteger(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }

  return Math.floor(number);
}

function deduplicateObjectIds(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set();

  return values.filter((value) => {
    if (!value) {
      return false;
    }

    const normalized = String(value);

    if (seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);
    return true;
  });
}

// ======================================================
// Pre-save cleanup
// ======================================================

UserSchema.pre("save", async function normalizeUser(next) {
  try {
    if (
      this.isModified("username") &&
      typeof this.username === "string"
    ) {
      this.username = this.username
        .trim()
        .replace(/\s+/g, "");
    }

    if (
      this.isModified("email") &&
      typeof this.email === "string"
    ) {
      this.email = this.email
        .trim()
        .toLowerCase();
    }

    if (typeof this.name === "string") {
      this.name = this.name.trim();
    }

    if (typeof this.bio === "string") {
      this.bio = this.bio.trim();
    }

    if (typeof this.avatar === "string") {
      this.avatar = this.avatar.trim();
    }

    if (typeof this.profileBackdrop === "string") {
      this.profileBackdrop =
        this.profileBackdrop.trim();
    }

    if (typeof this.tvProfileBackdrop === "string") {
      this.tvProfileBackdrop =
        this.tvProfileBackdrop.trim();
    }

    if (this.isModified("password") && this.password) {
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(
        this.password,
        salt
      );
    }

    // ==================================================
    // Movie watchlist
    // ==================================================

    if (Array.isArray(this.watchlist)) {
      const seenMovieIds = new Set();

      this.watchlist = this.watchlist.filter(
        (item) => {
          if (!item) {
            return false;
          }

          const tmdbId = Number(item.tmdbId);

          if (
            !Number.isInteger(tmdbId) ||
            tmdbId <= 0 ||
            seenMovieIds.has(tmdbId)
          ) {
            return false;
          }

          item.tmdbId = tmdbId;
          item.title = trimValue(item.title);
          item.posterPath = trimValue(
            item.posterPath
          );
          item.poster_path = trimValue(
            item.poster_path
          );
          item.backdropPath = trimValue(
            item.backdropPath
          );
          item.release_date = trimValue(
            item.release_date
          );

          if (!item.posterPath && item.poster_path) {
            item.posterPath = item.poster_path;
          }

          if (!item.poster_path && item.posterPath) {
            item.poster_path = item.posterPath;
          }

          seenMovieIds.add(tmdbId);
          return true;
        }
      );
    }

    // ==================================================
    // TV watchlist
    // ==================================================

    if (Array.isArray(this.tvWatchlist)) {
      const seenShowIds = new Set();

      this.tvWatchlist = this.tvWatchlist.filter(
        (item) => {
          if (!item) {
            return false;
          }

          const tmdbId = Number(item.tmdbId);

          if (
            !Number.isInteger(tmdbId) ||
            tmdbId <= 0 ||
            seenShowIds.has(tmdbId)
          ) {
            return false;
          }

          item.tmdbId = tmdbId;
          item.name = trimValue(item.name);
          item.nameAr = trimValue(item.nameAr);
          item.originalName = trimValue(
            item.originalName
          );
          item.posterPath = trimValue(
            item.posterPath
          );
          item.backdropPath = trimValue(
            item.backdropPath
          );
          item.firstAirDate = trimValue(
            item.firstAirDate
          );
          item.status = trimValue(item.status);

          seenShowIds.add(tmdbId);
          return true;
        }
      );
    }

    // ==================================================
    // Favorite Movie Top Four
    // ==================================================

    if (Array.isArray(this.favoriteFilms)) {
      const seenFilmIds = new Set();

      this.favoriteFilms = this.favoriteFilms
        .filter((film) => {
          if (!film) {
            return false;
          }

          const tmdbId = Number(film.tmdbId);

          if (
            !Number.isInteger(tmdbId) ||
            tmdbId <= 0 ||
            seenFilmIds.has(tmdbId)
          ) {
            return false;
          }

          film.tmdbId = tmdbId;
          film.title = trimValue(film.title);
          film.titleAr = trimValue(film.titleAr);
          film.poster_path = trimValue(
            film.poster_path
          );
          film.backdropPath = trimValue(
            film.backdropPath
          );

          seenFilmIds.add(tmdbId);
          return true;
        })
        .slice(0, 4);
    }

    // ==================================================
    // Favorite Show Top Four
    // ==================================================

    if (Array.isArray(this.favoriteShows)) {
      const seenShowIds = new Set();

      this.favoriteShows = this.favoriteShows
        .filter((show) => {
          if (!show) {
            return false;
          }

          const tmdbId = Number(show.tmdbId);

          if (
            !Number.isInteger(tmdbId) ||
            tmdbId <= 0 ||
            seenShowIds.has(tmdbId)
          ) {
            return false;
          }

          show.tmdbId = tmdbId;
          show.name = trimValue(show.name);
          show.nameAr = trimValue(show.nameAr);
          show.originalName = trimValue(
            show.originalName
          );
          show.posterPath = trimValue(
            show.posterPath
          );
          show.backdropPath = trimValue(
            show.backdropPath
          );

          seenShowIds.add(tmdbId);
          return true;
        })
        .slice(0, 4);
    }

    // ==================================================
    // Lightweight Movie favorite IDs
    // ==================================================

    if (Array.isArray(this.favorites)) {
      const seen = new Set();

      this.favorites = this.favorites
        .map((value) => Number(value))
        .filter((value) => {
          if (
            !Number.isInteger(value) ||
            value <= 0 ||
            seen.has(value)
          ) {
            return false;
          }

          seen.add(value);
          return true;
        });
    }

    // ==================================================
    // Social graph
    // ==================================================

    this.following = deduplicateObjectIds(
      this.following
    );

    this.followers = deduplicateObjectIds(
      this.followers
    );

    // A user should never follow themselves.
    if (this._id) {
      const selfId = String(this._id);

      this.following = this.following.filter(
        (userId) => String(userId) !== selfId
      );

      this.followers = this.followers.filter(
        (userId) => String(userId) !== selfId
      );
    }

    // ==================================================
    // Recent GIFs
    // ==================================================

    if (Array.isArray(this.recentGifs)) {
      const seenGifs = new Set();

      this.recentGifs = this.recentGifs
        .filter(
          (value) => typeof value === "string"
        )
        .map((value) => value.trim())
        .filter((value) => {
          if (!value || seenGifs.has(value)) {
            return false;
          }

          seenGifs.add(value);
          return true;
        })
        .slice(0, 30);
    }

    // ==================================================
    // Cached counters
    // ==================================================

    const counterFields = [
      "totalLogs",
      "totalEpisodeWatches",
      "totalUniqueEpisodesWatched",
      "totalEpisodeRewatches",
      "totalTVWatchMinutes",
      "totalSeasonsCompleted",
      "totalShowsStarted",
      "totalShowsCompleted",
    ];

    for (const field of counterFields) {
      this[field] = normalizeNonNegativeInteger(
        this[field]
      );
    }

    if (
      this.totalEpisodeRewatches >
      this.totalEpisodeWatches
    ) {
      this.totalEpisodeRewatches =
        this.totalEpisodeWatches;
    }

    if (
      this.totalUniqueEpisodesWatched >
      this.totalEpisodeWatches
    ) {
      this.totalUniqueEpisodesWatched =
        this.totalEpisodeWatches;
    }

    // ==================================================
    // Device tokens
    // ==================================================

    if (Array.isArray(this.deviceTokens)) {
      const seenTokens = new Set();

      this.deviceTokens = this.deviceTokens
        .map((entry) => {
          // Migrate old string tokens automatically.
          if (typeof entry === "string") {
            const cleanToken = entry.trim();

            if (!cleanToken) {
              return null;
            }

            return {
              token: cleanToken,
              provider: "fcm",
              platform: "unknown",
              updatedAt: new Date(),
            };
          }

          if (
            !entry ||
            typeof entry.token !== "string"
          ) {
            return null;
          }

          const cleanToken = entry.token.trim();

          if (!cleanToken) {
            return null;
          }

          return {
            token: cleanToken,
            provider:
              trimValue(entry.provider) || "fcm",
            platform:
              entry.platform || "unknown",
            updatedAt:
              entry.updatedAt || new Date(),
          };
        })
        .filter(Boolean)
        .filter((entry) => {
          if (seenTokens.has(entry.token)) {
            return false;
          }

          seenTokens.add(entry.token);
          return true;
        });
    }

    next();
  } catch (error) {
    next(error);
  }
});

// ======================================================
// Password helper
// ======================================================

UserSchema.methods.matchPassword =
  async function matchPassword(password) {
    if (!this.password) {
      return false;
    }

    return bcrypt.compare(password, this.password);
  };

// ======================================================
// Device token helpers
// ======================================================

UserSchema.methods.addDeviceToken =
  async function addDeviceToken(
    token,
    provider = "fcm",
    platform = "unknown"
  ) {
    if (!token || typeof token !== "string") {
      return this;
    }

    const cleanToken = token.trim();

    if (!cleanToken) {
      return this;
    }

    if (!Array.isArray(this.deviceTokens)) {
      this.deviceTokens = [];
    }

    const existing = this.deviceTokens.find(
      (entry) => {
        if (typeof entry === "string") {
          return entry === cleanToken;
        }

        return entry.token === cleanToken;
      }
    );

    if (existing) {
      if (typeof existing === "string") {
        this.deviceTokens =
          this.deviceTokens.map((entry) =>
            entry === cleanToken
              ? {
                  token: cleanToken,
                  provider,
                  platform,
                  updatedAt: new Date(),
                }
              : entry
          );
      } else {
        existing.provider = provider;
        existing.platform = platform;
        existing.updatedAt = new Date();
      }
    } else {
      this.deviceTokens.push({
        token: cleanToken,
        provider,
        platform,
        updatedAt: new Date(),
      });
    }

    await this.save();
    return this;
  };

UserSchema.methods.removeDeviceToken =
  async function removeDeviceToken(token) {
    if (!token || typeof token !== "string") {
      return this;
    }

    if (!Array.isArray(this.deviceTokens)) {
      return this;
    }

    const cleanToken = token.trim();

    this.deviceTokens = this.deviceTokens.filter(
      (entry) => {
        if (typeof entry === "string") {
          return entry !== cleanToken;
        }

        return entry.token !== cleanToken;
      }
    );

    await this.save();
    return this;
  };

// ======================================================
// Helpful virtuals
// ======================================================

UserSchema.virtual("tvTopFour").get(
  function getTVTopFour() {
    return Array.isArray(this.favoriteShows)
      ? this.favoriteShows
      : [];
  }
);

UserSchema.virtual("movieTopFour").get(
  function getMovieTopFour() {
    return Array.isArray(this.favoriteFilms)
      ? this.favoriteFilms
      : [];
  }
);

UserSchema.set("toJSON", {
  virtuals: true,
});

UserSchema.set("toObject", {
  virtuals: true,
});

// ======================================================
// Export
// ======================================================

module.exports =
  mongoose.models.User ||
  mongoose.model("User", UserSchema);

  