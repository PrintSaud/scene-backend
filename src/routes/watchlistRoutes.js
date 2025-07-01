// src/routes/watchlistRoutes.js
const express = require("express");
const router = express.Router();
const User = require("../models/user");
const protect = require("../middleware/authMiddleware");
const { getMovieDetails } = require("../services/tmdbService");

// ✅ Add to watchlist: POST /api/users/:userId/watchlist
router.post("/:userId/watchlist", async (req, res) => {
  const { userId } = req.params;
  const { tmdbId } = req.body;
  if (!tmdbId) return res.status(400).json({ error: "tmdbId is required" });

  try {
    const user = await User.findByIdAndUpdate(
      userId,
      { $addToSet: { watchlist: tmdbId } },
      { new: true }
    );

    const movieDetails = await Promise.all(
      user.watchlist.map((tmdbId) => getMovieDetails(tmdbId))
    );

    res.json(movieDetails);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not add to watchlist" });
  }
});

// ✅ Remove from watchlist: DELETE /api/users/:userId/watchlist/:tmdbId
router.delete("/:userId/watchlist/:tmdbId", async (req, res) => {
  const { userId, tmdbId } = req.params;

  try {
    const user = await User.findByIdAndUpdate(
      userId,
      { $pull: { watchlist: Number(tmdbId) } },
      { new: true }
    );

    res.json(user.watchlist);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not remove from watchlist" });
  }
});

// ✅ Get full movie data: GET /api/users/:userId/watchlist
router.get("/:userId/watchlist", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user || !user.watchlist)
      return res.status(404).json({ error: "User or watchlist not found" });

    const movieDetails = await Promise.all(
      user.watchlist.map((tmdbId) => getMovieDetails(tmdbId))
    );

    res.json(movieDetails);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not fetch full movie data from watchlist" });
  }
});

// ✅ NEW: Check if movie is in watchlist (cleaner method using protect + token)
// GET /api/watchlist/status/:movieId
router.get("/status/:movieId", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const movieId = Number(req.params.movieId);
    const inWatchlist = user.watchlist?.includes(movieId);
    res.json({ inWatchlist });
  } catch (err) {
    console.error("Watchlist check error:", err);
    res.status(500).json({ error: "Failed to check watchlist" });
  }
});

// ✅ POST /api/watchlist/toggle → toggles watchlist for logged-in user
router.post("/toggle", protect, async (req, res) => {
  const { movieId } = req.body;
  const userId = req.user._id;

  try {
    const user = await User.findById(userId);
    const alreadyIn = user.watchlist?.includes(movieId);

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      alreadyIn
        ? { $pull: { watchlist: movieId } }
        : { $addToSet: { watchlist: movieId } },
      { new: true }
    );

    res.json({
      message: alreadyIn ? "Removed from watchlist" : "Added to watchlist",
      inWatchlist: !alreadyIn,
    });
  } catch (err) {
    console.error("Toggle watchlist error:", err);
    res.status(500).json({ error: "Failed to toggle watchlist" });
  }
});


module.exports = router;
