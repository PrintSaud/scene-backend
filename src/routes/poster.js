const express = require("express");
const router = express.Router();
const CustomPoster = require("../models/customPoster"); // ✅ use your existing model
const protect = require("../middleware/authMiddleware"); // 🔐 to get req.user

// PATCH /api/posters/:movieId → update poster for a movie
router.patch("/:movieId", protect, async (req, res) => {
  const { posterUrl } = req.body;
  const movieId = Number(req.params.movieId); // 🔢 force number

  if (!posterUrl) {
    return res.status(400).json({ message: "Poster URL required" });
  }

  try {
    const updated = await CustomPoster.findOneAndUpdate(
      { movieId },
      {
        posterUrl,
        updatedBy: req.user._id,
        updatedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    res.json({ message: "✅ Poster updated", poster: updated });
  } catch (err) {
    console.error("❌ Failed to update custom poster:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
