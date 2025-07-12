// src/models/user.js

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

  watchlist: { type: [Number], default: [] },
  favorites: { type: [Number], default: [] },

  following: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'User',
    default: []
  },
  followers: {  // ✅ Added followers array
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'User',
    default: []
  },

  customPosters: {
    type: Map,
    of: String,
    default: {}
  },

  profileBackdrop: { type: String, default: '' },
  favoriteCharacter: { type: String, default: '' },
  favoriteActor: { type: String, default: '' },
  topMovies: { type: [String], default: [] },
  recentGifs: [{ type: String }],

  resetCode: { type: String, default: null },
  resetCodeExpires: { type: Date, default: null },

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

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

UserSchema.methods.matchPassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
