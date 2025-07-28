const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  googleId: { type: String },
  username: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: {
    type: String,
    required: function () {
      return !this.googleId;
    }
  },
  bio: { type: String },

  watchlist: [
    {
      tmdbId: { type: Number, index: true },  // ✅ add index
      title: String,
      posterPath: String,
      addedAt: Date,
    }
  ],
  
  
  
  favorites: { type: [Number], default: [] },

  favoriteFilms: {
    type: [
      {
        id: { type: Number, required: true },
        title: { type: String, required: true },
        poster: { type: String }
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

  

  notifications: [
    {
      type: { type: String },
      message: String,
      logId: { type: mongoose.Schema.Types.ObjectId, ref: "Log" },
      fromUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      createdAt: { type: Date, default: Date.now },
      read: { type: Boolean, default: false }
    }
  ],

  avatar: { type: String, default: "" }

}, { timestamps: true });

// 🔒 Pre-save hook: hash password if changed + clean watchlist
UserSchema.pre('save', async function (next) {
  try {
    if (this.isModified('password')) {
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
    }

    // 🔥 Defensive cleanup: remove invalid watchlist items before save
    if (Array.isArray(this.watchlist)) {
      this.watchlist = this.watchlist.filter(item => typeof item.tmdbId === 'number');
    }

    next();
  } catch (err) {
    next(err);
  }
});

UserSchema.methods.matchPassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
