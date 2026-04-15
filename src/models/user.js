// src/models/user.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  googleId: { type: String },

  // Keep username normalized to lowercase for uniqueness checks
  username: { type: String, required: true, index: true },

  email: { type: String, required: true, unique: true, index: true },

  password: {
    type: String,
    required: function () {
      return !this.googleId;
    }
  },

  bio: { type: String, default: '' },

  watchlist: [
    {
      tmdbId: { type: Number, index: true },  // indexed for quick lookups
      title: String,
      posterPath: String,
      addedAt: Date,
    }
  ],

  language: { type: String, default: "en" },

  noNewFollowers: { type: Boolean, default: false },
  favorites: { type: [Number], default: [] },

  favoriteFilms: {
    type: [
      {
        tmdbId: { type: Number },
        title: String,
        poster_path: String,
      }
    ],
    default: []
  },

  following: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'User',
    default: []
  },
  followers: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'User',
    default: []
  },

  customPosters: {
    type: Map,
    of: String,
    default: {}
  },

  totalLogs: { type: Number, default: 0 },

  profileBackdrop: { type: String, default: '' },
  favoriteCharacter: { type: String, default: '' },
  favoriteActor: { type: String, default: '' },
  topMovies: { type: [String], default: [] },
  recentGifs: [{ type: String }],

  socials: {
    X: { type: String, default: "" },
    youtube: { type: String, default: "" },
    instagram: { type: String, default: "" },
    tiktok: { type: String, default: "" },
    imdb: { type: String, default: "" },
    tmdb: { type: String, default: "" },
    website: { type: String, default: "" },
  },

  resetCode: { type: String, default: null },
  resetCodeExpires: { type: Date, default: null },

  verificationCode: { type: String },
  verificationCodeExpires: { type: Date },

  // ---- notifications: removed in favor of Notification collection ----
  // If you still want an embedded cache, you can add a small lightweight array here.
  // notifications: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Notification' }],

  // Device tokens for push notifications (support multiple devices)
// Device tokens for push notifications (support multiple devices)
deviceTokens: {
  type: [
    {
      token: { type: String, required: true },
      provider: { type: String, default: "fcm" }, // "fcm" for now
      platform: { type: String, enum: ["ios", "android", "unknown"], default: "unknown" },
      updatedAt: { type: Date, default: Date.now },
    }
  ],
  default: []
},

  // per-user push preferences
  pushSettings: {
    muteAll: { type: Boolean, default: false },         // quick global opt-out
    muteFollow: { type: Boolean, default: false },
    muteReplies: { type: Boolean, default: false },
    muteLikes: { type: Boolean, default: false },
  },

  // small profile fields:
  avatar: { type: String, default: "" }

}, { timestamps: true });

// Indexes: compound or additional can be added if needed
UserSchema.index({ email: 1 }, { unique: true });

// 🔒 Pre-save hook: hash password if changed + normalize username + clean watchlist
UserSchema.pre('save', async function (next) {
  try {
    // normalize username to lowercase (and remove spaces)
    if (this.isModified('username') && typeof this.username === 'string') {
      this.username = this.username.trim().replace(/\s+/g, '');
    }

    if (this.isModified('password') && this.password) {
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
    }

    // defensive cleanup: remove invalid watchlist items before save
    if (Array.isArray(this.watchlist)) {
      this.watchlist = this.watchlist.filter(item => typeof item.tmdbId === 'number');
    }

    // ensure deviceTokens are unique and strings
    // ensure deviceTokens are unique and valid
if (Array.isArray(this.deviceTokens)) {
  const seen = new Set();

  this.deviceTokens = this.deviceTokens
    .map((entry) => {
      // migrate old string tokens automatically
      if (typeof entry === "string") {
        return {
          token: entry.trim(),
          provider: "fcm",
          platform: "unknown",
          updatedAt: new Date(),
        };
      }

      if (!entry || typeof entry.token !== "string") return null;

      const cleanToken = entry.token.trim();
      if (!cleanToken) return null;

      return {
        token: cleanToken,
        provider: entry.provider || "fcm",
        platform: entry.platform || "unknown",
        updatedAt: entry.updatedAt || new Date(),
      };
    })
    .filter(Boolean)
    .filter((entry) => {
      if (seen.has(entry.token)) return false;
      seen.add(entry.token);
      return true;
    });
}

    next();
  } catch (err) {
    next(err);
  }
});

// Password compare helper
UserSchema.methods.matchPassword = async function (password) {
  if (!this.password) return false;
  return await bcrypt.compare(password, this.password);
};

// Add / remove device tokens (use these from your save-token route)
UserSchema.methods.addDeviceToken = async function (token, provider = "fcm", platform = "unknown") {
  if (!token || typeof token !== "string") return this;

  const cleanToken = token.trim();
  if (!cleanToken) return this;

  if (!Array.isArray(this.deviceTokens)) {
    this.deviceTokens = [];
  }

  const existing = this.deviceTokens.find((entry) => {
    if (typeof entry === "string") return entry === cleanToken;
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
  if (!token || typeof token !== "string") return this;
  if (!Array.isArray(this.deviceTokens)) return this;

  const cleanToken = token.trim();

  this.deviceTokens = this.deviceTokens.filter((entry) => {
    if (typeof entry === "string") return entry !== cleanToken;
    return entry.token !== cleanToken;
  });

  await this.save();
  return this;
};

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
