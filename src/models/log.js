const mongoose = require('mongoose');

// Schema for replies
const replySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, default: "" },
  gif: { type: String, default: "" },
  image: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
});

// Schema for logs
const logSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    movie: { type: String }, // or Number

    title: String,
    poster: String,

    review: { type: String, default: '' },
    rating: { type: Number, min: 0, max: 5 },
    rewatch: { type: Boolean, default: false },
    watchedAt: { type: Date, default: Date.now },

    // 🔥 NEW FIELDS
    gif: { type: String, default: "" },     // Main log Giphy URL
    image: { type: String, default: "" },   // Main log uploaded image

    reactions: {
      type: Map,
      of: [mongoose.Schema.Types.ObjectId],
      default: {},
    },

    replies: [replySchema],
  },
  { timestamps: true }
);



module.exports = mongoose.models.Log || mongoose.model('Log', logSchema);
