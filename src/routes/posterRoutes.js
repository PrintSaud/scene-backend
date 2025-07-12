const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const CustomPoster = require("../models/customPoster");

// ✅ GET current poster override for a single movie
router.get("/:movieId", async (req, res) => {
  try {
    const poster = await CustomPoster.findOne({ movieId: req.params.movieId });
    if (!poster) {
      return res.json({ posterUrl: null }); // Always 200 with null if no override
    }
    res.json({ posterUrl: poster.posterUrl });
  } catch (err) {
    console.error("Failed to fetch poster override:", err);
    res.status(500).json({ message: "Server error fetching poster override" });
  }
});

// ✅ POST or update a poster override for a movie
router.post("/:movieId", protect, async (req, res) => {
  const { posterUrl } = req.body;
  if (!posterUrl) return res.status(400).json({ error: "posterUrl required" });

  try {
    const updated = await CustomPoster.findOneAndUpdate(
      { movieId: req.params.movieId },
      { posterUrl, updatedBy: req.user._id, updatedAt: new Date() },
      { new: true, upsert: true }
    );

    res.json({ message: "Poster override saved", poster: updated });
  } catch (err) {
    console.error("Failed to update poster override:", err);
    res.status(500).json({ message: "Server error saving poster override" });
  }
});

// 🔥 Optional: GET all poster overrides (for admin/debug/tools)
router.get("/", async (req, res) => {
  try {
    const posters = await CustomPoster.find({});
    res.json(posters);
  } catch (err) {
    console.error("Failed to fetch all poster overrides:", err);
    res.status(500).json({ message: "Server error fetching poster overrides" });
  }
});

module.exports = router;
