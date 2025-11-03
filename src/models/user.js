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
  deviceTokens: {
    type: [String],
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
      this.username = this.username.toLowerCase().trim().replace(/\s+/g, '');
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
    if (Array.isArray(this.deviceTokens)) {
      this.deviceTokens = Array.from(new Set(this.deviceTokens.filter(t => typeof t === 'string' && t.trim())));
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
UserSchema.methods.addDeviceToken = async function (token) {
  if (!token || typeof token !== 'string') return this;
  if (!Array.isArray(this.deviceTokens)) this.deviceTokens = [];
  if (!this.deviceTokens.includes(token)) {
    this.deviceTokens.push(token);
    await this.save();
  }
  return this;
};

UserSchema.methods.removeDeviceToken = async function (token) {
  if (!Array.isArray(this.deviceTokens)) return this;
  const idx = this.deviceTokens.indexOf(token);
  if (idx !== -1) {
    this.deviceTokens.splice(idx, 1);
    await this.save();
  }
  return this;
};

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
