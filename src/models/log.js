const mongoose = require('mongoose');

// Schema for replies
const replySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, default: "" },
  gif: { type: String, default: "" },
  image: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // ✅ Add this line for reply likes
});


// Schema for logs
const logSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    movie: { type: String },
    title: String,
    poster: String,
    review: { type: String, default: '' },
    rating: { type: Number, min: 0, max: 5 },
    rewatch: { type: Boolean, default: false },
    watchedAt: { type: Date, default: Date.now },
    gif: { type: String, default: "" },
    image: { type: String, default: "" },
    replies: [replySchema],
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],  // ✅ ADD THIS LINE
    customBackdrop: { type: String, default: "" },
  },
  { timestamps: true }
);




module.exports = mongoose.models.Log || mongoose.model('Log', logSchema);
