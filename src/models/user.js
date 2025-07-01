// src/models/user.js


const mongoose = require('mongoose');
const bcrypt = require("bcryptjs");


const UserSchema = new mongoose.Schema({
  googleId: { type: String }, // only for Google-authenticated users
  username: { type: String, required: true },
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: function () {
    // If this user is logging in with Google, they don’t need a password
    return !this.googleId;
  }},
  
  bio:      { type: String },
  avatar:   { type: String },

  watchlist: {
    type: [Number],
    default: []
  },

  favorites: {
    type: [Number],
    default: []
  },

  following: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'User',
    default: []
  },

  customPosters: {
    type: Map,
    of: String, // Key = TMDB movie ID, Value = poster path
    default: {}
  },

  profileBackdrop: {
    type: String,
    default: ''
  },

  favoriteCharacter: {
    type: String,
    default: ''
  },
  favoriteActor: {
    type: String,
    default: ''
  },
  
  topMovies: {
    type: [String], // TMDB IDs
    default: []
  },

  recentGifs: [{ type: String }],


  resetCode: {
    type: String,
    default: null,
  },
  
  resetCodeExpires: {
    type: Date,
    default: null,
  },

  notifications: [
    {
      type: { type: String }, // e.g., "reply"
      message: String,
      logId: { type: mongoose.Schema.Types.ObjectId, ref: "Log" },
      fromUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      createdAt: { type: Date, default: Date.now },
      read: { type: Boolean, default: false },
    },
  ],
  

  avatar: { type: String, default: "" } // optional avatar URL



  
  

  
  

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
