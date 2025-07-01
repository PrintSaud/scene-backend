// models/customPoster.js
const mongoose = require("mongoose");

const customPosterSchema = new mongoose.Schema({
  movieId: { type: Number, required: true, unique: true },
  posterUrl: { type: String, required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("CustomPoster", customPosterSchema);
