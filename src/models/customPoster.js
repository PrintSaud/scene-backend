const mongoose = require("mongoose");

const customPosterSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  movieId: { type: Number, required: true },
  posterUrl: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now },
});

// ✅ Add compound unique index so one user can set one poster for one movie
customPosterSchema.index({ userId: 1, movieId: 1 }, { unique: true });

module.exports = mongoose.models.CustomPoster || mongoose.model("CustomPoster", customPosterSchema);
