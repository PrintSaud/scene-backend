const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const CustomPoster = require("../models/customPoster");

// ✅ GET current poster for a movie
router.get("/:movieId", async (req, res) => {
  const poster = await CustomPoster.findOne({ movieId: req.params.movieId });
  if (!poster) return res.status(404).json({ message: "No override" });
  res.json(poster);
});

// ✅ POST a new poster for a movie
router.post("/:movieId", protect, async (req, res) => {
  const { posterUrl } = req.body;
  if (!posterUrl) return res.status(400).json({ error: "posterUrl required" });

  const updated = await CustomPoster.findOneAndUpdate(
    { movieId: req.params.movieId },
    { posterUrl, updatedBy: req.user._id, updatedAt: new Date() },
    { new: true, upsert: true }
  );

  res.json({ message: "Poster updated", poster: updated });
});

module.exports = router;
