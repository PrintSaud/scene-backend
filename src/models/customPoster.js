// models/customPoster.js
const mongoose = require("mongoose");

const customPosterSchema = new mongoose.Schema({
  movieId: { type: Number, required: true, unique: true }, // TMDB id
  posterUrl: { type: String, required: true },             // Custom poster URL (e.g. Cloudinary)
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.models.CustomPoster || mongoose.model("CustomPoster", customPosterSchema);
