const mongoose = require('mongoose');

const PollSchema = new mongoose.Schema({
  question: { type: String, required: true },
  options: [{ type: String, required: true }],
  votes: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    optionIndex: Number
  }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false }, // optional if AI-generated
  replies: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text: String,
    createdAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Poll', PollSchema);
