const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  movieTitle: { type: String }, // e.g. "Whiplash"
moviePoster: { type: String }, // if you want thumbnails in notifs
  type: { type: String, required: true }, // 'follow', 'reply', etc.
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  message: { type: String },
  relatedId: { type: String }, // poll ID, log ID, etc.
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Notification', NotificationSchema);
