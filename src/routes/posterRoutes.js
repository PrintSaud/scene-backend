const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const CustomPoster = require("../models/customPoster");


// ✅ POST or update a poster override for a movie (per user)
router.post("/:movieId", protect, async (req, res) => {
  const { posterUrl } = req.body;
  const userId = req.user._id;
  const movieId = req.params.movieId;

  if (!posterUrl) return res.status(400).json({ error: "posterUrl required" });

  try {
    const updated = await CustomPoster.findOneAndUpdate(
      { userId: userId, movieId: { $in: [Number(movieId), String(movieId)] } },
      { posterUrl, updatedAt: new Date() },
      { new: true, upsert: true }
    );

    res.json({ message: "Poster override saved", poster: updated });
  } catch (err) {
    console.error("❌ Failed to update poster override:", err);
    res.status(500).json({ message: "Server error saving poster override" });
  }
});

// 🔥 Optional: GET all poster overrides (for admin/debug/tools)
router.get("/", async (req, res) => {
  try {
    const posters = await CustomPoster.find({});
    res.json(posters);
  } catch (err) {
    console.error("❌ Failed to fetch all poster overrides:", err);
    res.status(500).json({ message: "Server error fetching poster overrides" });
  }
});

// ✅ GET all poster overrides for a specific user (for lists, etc.)
router.get("/user/:userId", async (req, res) => {
  try {
    const posters = await CustomPoster.find({ userId: req.params.userId }).lean();
    res.json(posters); // Will return [{ movieId, posterUrl }]
  } catch (err) {
    console.error("❌ Failed to fetch custom posters:", err);
    res.status(500).json({ error: 'Failed to fetch custom posters' });
  }
});

// ✅ PATCHED POST /api/posters/batch
router.post("/batch", async (req, res) => {
  try {
    const { userId, movieIds } = req.body;

    console.log("📥 Batch Poster Request Received:", {
      userId,
      movieIds,
    });

    if (!userId || !Array.isArray(movieIds)) {
      console.warn("❌ Missing userId or movieIds array");
      return res.status(400).json({ message: "Missing or invalid data" });
    }

    // Clean and sanitize movieIds
    const validIds = movieIds
      .map((id) => Number(id))
      .filter((id) => !isNaN(id));

    if (!validIds.length) {
      console.warn("⚠️ No valid movieIds after cleanup:", movieIds);
      return res.status(400).json({ message: "No valid movieIds" });
    }

    const posters = await CustomPoster.find({
      userId: userId,
      movieId: { $in: validIds },
    });

    console.log(`🎯 Found ${posters.length} custom poster(s)`);

    const result = {};
    posters.forEach((p) => {
      result[p.movieId] = p.posterUrl;
    });

    return res.json(result);
  } catch (err) {
    console.error("❌ Custom poster batch error:", err);
    res.status(500).json({ message: "Server error fetching custom posters" });
  }
});




// ✅ GET current poster override for a single movie (per user)
router.get("/:movieId", async (req, res) => {
  const { movieId } = req.params;
  const { userId } = req.query;

  if (!userId || !movieId) {
    return res.status(400).json({ message: 'userId and movieId required' });
  }

  try {
    const poster = await CustomPoster.findOne({
      userId: userId,
      movieId: { $in: [Number(movieId), String(movieId)] }
    });

    res.json({
      posterOverride: poster ? poster.posterUrl : null
    });
  } catch (err) {
    console.error("❌ Failed to fetch poster override:", err);
    res.status(500).json({ message: "Server error fetching poster override" });
  }
});

module.exports = router;
