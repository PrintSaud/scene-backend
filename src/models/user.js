// src/models/user.js

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema(
  {
    googleId: {
      type: String,
      default: null,
    },

    // Existing usernames are left case-preserving to avoid breaking accounts.
    // Spaces are removed in the pre-save hook.
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
    
      // Preserve established accounts that existed before this field.
      // New registration explicitly sets this to false.
      default: true,
      index: true,
    },

    password: {
      type: String,
      required: function () {
        return !this.googleId;
      },
    },

    bio: {
      type: String,
      default: "",
    },

    language: {
      type: String,
      default: "en",
    },

    avatar: {
      type: String,
      default: "",
    },

    // =========================
    // Scene mode
    // =========================

    preferredMode: {
      type: String,
      enum: ["movies", "tv"],
      default: "movies",
    },

    // =========================
    // Movie profile
    // =========================

    watchlist: {
      type: [
        {
          tmdbId: {
            type: Number,
            required: true,
          },
    
          title: {
            type: String,
            default: "",
          },
    
          // Current normalized field.
          posterPath: {
            type: String,
            default: "",
          },
    
          // Preserve compatibility with existing clients/imports.
          poster_path: {
            type: String,
            default: "",
          },
    
          release_date: {
            type: String,
            default: "",
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
            type: [
              {
                id: {
                  type: Number,
                  default: null,
                },
    
                name: {
                  type: String,
                  default: "",
                },
              },
            ],
            default: [],
          },
    
          addedAt: {
            type: Date,
            default: Date.now,
          },
        },
      ],
    
      default: [],
    },

    favorites: {
      type: [Number],
      default: [],
    },

    favoriteFilms: {
      type: [
        {
          tmdbId: {
            type: Number,
            required: true,
          },
          title: {
            type: String,
            default: "",
          },

          // Keep the existing field name for frontend compatibility.
          poster_path: {
            type: String,
            default: "",
          },
        },
      ],
      default: [],
      validate: {
        validator: function (films) {
          return Array.isArray(films) && films.length <= 4;
        },
        message: "A user can have no more than four favorite films.",
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
    },

    favoriteCharacter: {
      type: String,
      default: "",
    },

    favoriteActor: {
      type: String,
      default: "",
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

    // =========================
    // Scene TV profile
    // =========================

    tvWatchlist: {
      type: [
        {
          tmdbId: {
            type: Number,
            required: true,
          },
          name: {
            type: String,
            default: "",
          },
          posterPath: {
            type: String,
            default: "",
          },
          firstAirDate: {
            type: String,
            default: "",
          },
          addedAt: {
            type: Date,
            default: Date.now,
          },
        },
      ],
      default: [],
    },

    favoriteShows: {
      type: [
        {
          tmdbId: {
            type: Number,
            required: true,
          },
          name: {
            type: String,
            default: "",
          },
          posterPath: {
            type: String,
            default: "",
          },
        },
      ],
      default: [],
      validate: {
        validator: function (shows) {
          return Array.isArray(shows) && shows.length <= 4;
        },
        message: "A user can have no more than four favorite shows.",
      },
    },

    tvProfileBackdrop: {
      type: String,
      default: "",
    },

    totalEpisodeWatches: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalShowsStarted: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalShowsCompleted: {
      type: Number,
      default: 0,
      min: 0,
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
        type: mongoose.Schema.Types.ObjectId,
        ref: "TVImportJob",
        default: null,
      },
    },

    // =========================
    // Social graph
    // =========================

    following: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },

    followers: {
      type: [mongoose.Schema.Types.ObjectId],
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
      },
      youtube: {
        type: String,
        default: "",
      },
      instagram: {
        type: String,
        default: "",
      },
      tiktok: {
        type: String,
        default: "",
      },
      imdb: {
        type: String,
        default: "",
      },
      tmdb: {
        type: String,
        default: "",
      },
      website: {
        type: String,
        default: "",
      },
    },

    recentGifs: {
      type: [String],
      default: [],
    },

    // =========================
    // Password reset and verification
    // =========================

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

    // =========================
    // Push notifications
    // =========================

    deviceTokens: {
      type: [
        {
          token: {
            type: String,
            required: true,
          },

          provider: {
            type: String,
            default: "fcm",
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
      ],
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

      // Scene TV notification settings
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
  }
);

// =========================
// Indexes
// =========================

// `email` and `username` already declare indexes
// directly in their field definitions.

UserSchema.index({ googleId: 1 }, {
  sparse: true,
});

UserSchema.index({
  "deviceTokens.token": 1,
});

UserSchema.index({
  createdAt: -1,
});

// =========================
// Pre-save cleanup
// =========================

UserSchema.pre("save", async function (next) {
  try {
    // Preserve username capitalization for existing frontend behavior,
    // but remove whitespace.
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

    if (this.isModified("password") && this.password) {
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
    }

    if (Array.isArray(this.watchlist)) {
      const seenMovieIds = new Set();
    
      this.watchlist = this.watchlist.filter((item) => {
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
    
        if (!item.posterPath && item.poster_path) {
          item.posterPath = item.poster_path;
        }
    
        if (!item.poster_path && item.posterPath) {
          item.poster_path = item.posterPath;
        }
    
        seenMovieIds.add(tmdbId);
    
        return true;
      });
    }

    if (Array.isArray(this.tvWatchlist)) {
      const seenShowIds = new Set();
    
      this.tvWatchlist = this.tvWatchlist.filter((item) => {
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
        seenShowIds.add(tmdbId);
    
        return true;
      });
    }

    // Keep only four unique favorite films.
    if (Array.isArray(this.favoriteFilms)) {
      const seenFavoriteFilmIds = new Set();

      this.favoriteFilms = this.favoriteFilms
        .filter((film) => {
          if (!film) {
            return false;
          }
          
          const tmdbId = Number(film.tmdbId);
          
          if (
            !Number.isInteger(tmdbId) ||
            tmdbId <= 0
          ) {
            return false;
          }
          
          film.tmdbId = tmdbId;

          if (seenFavoriteFilmIds.has(film.tmdbId)) {
            return false;
          }

          seenFavoriteFilmIds.add(film.tmdbId);
          return true;
        })
        .slice(0, 4);
    }

    // Keep only four unique favorite shows.
    if (Array.isArray(this.favoriteShows)) {
      const seenFavoriteShowIds = new Set();

      this.favoriteShows = this.favoriteShows
        .filter((show) => {
          if (!show || typeof show.tmdbId !== "number") {
            return false;
          }

          if (seenFavoriteShowIds.has(show.tmdbId)) {
            return false;
          }

          seenFavoriteShowIds.add(show.tmdbId);
          return true;
        })
        .slice(0, 4);
    }

    // Ensure device tokens are valid and unique.
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
            provider: entry.provider || "fcm",
            platform: entry.platform || "unknown",
            updatedAt: entry.updatedAt || new Date(),
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

// =========================
// Password helper
// =========================

UserSchema.methods.matchPassword = async function (password) {
  if (!this.password) {
    return false;
  }

  return bcrypt.compare(password, this.password);
};

// =========================
// Device token helpers
// =========================

UserSchema.methods.addDeviceToken = async function (
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

  const existing = this.deviceTokens.find((entry) => {
    if (typeof entry === "string") {
      return entry === cleanToken;
    }

    return entry.token === cleanToken;
  });

  if (existing) {
    if (typeof existing === "string") {
      this.deviceTokens = this.deviceTokens.map((entry) =>
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

UserSchema.methods.removeDeviceToken = async function (token) {
  if (!token || typeof token !== "string") {
    return this;
  }

  if (!Array.isArray(this.deviceTokens)) {
    return this;
  }

  const cleanToken = token.trim();

  this.deviceTokens = this.deviceTokens.filter((entry) => {
    if (typeof entry === "string") {
      return entry !== cleanToken;
    }

    return entry.token !== cleanToken;
  });

  await this.save();

  return this;
};

module.exports =
  mongoose.models.User ||
  mongoose.model("User", UserSchema);