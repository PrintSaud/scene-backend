const mongoose = require("mongoose");

const ShownDailyMovieSchema = new mongoose.Schema({
  tmdbId: { type: Number, required: true, unique: true },
  shownAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("ShownDailyMovie", ShownDailyMovieSchema);
