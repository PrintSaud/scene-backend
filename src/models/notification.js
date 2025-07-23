const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  movieTitle: { type: String }, // Optional: for richer display
  moviePoster: { type: String }, // Optional: show thumbnail in future
  type: { type: String, required: true }, // e.g., 'follow', 'reply'
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  message: { type: String },
  relatedId: { type: String }, // e.g., for review, reply, etc.
  movieId: { type: String },
  listId: { type: String },
  reviewId: { type: String },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Notification', NotificationSchema);
