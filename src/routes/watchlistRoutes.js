const express = require("express");
const router = express.Router();
const User = require("../models/user");
const protect = require("../middleware/authMiddleware");
const { getMovieDetails } = require("../services/tmdbService");

// ✅ Check watchlist status (auth only)
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

// ✅ Toggle watchlist (auth only)
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

// ✅ Add to watchlist manually (non-auth)
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

    let movieDetails = await Promise.all(
      user.watchlist.map((id) => getMovieDetails(id))
    );

    movieDetails = movieDetails.filter(Boolean); // ✅ Remove nulls

    res.json(movieDetails);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not add to watchlist" });
  }
});

// ✅ Remove from watchlist manually
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

// ✅ Full watchlist with sorting
router.get("/:userId/watchlist", async (req, res) => {
  const { userId } = req.params;
  const sort = req.query.sort || "title";
  const order = req.query.order === "desc" ? -1 : 1;

  try {
    const user = await User.findById(userId);
    if (!user || !user.watchlist)
      return res.status(404).json({ error: "User or watchlist not found" });

    let movieDetails = await Promise.all(
      user.watchlist.map((tmdbId) => getMovieDetails(tmdbId))
    );

    movieDetails = movieDetails.filter(Boolean); // ✅ Remove any failed/null responses

    movieDetails.sort((a, b) => {
      if (sort === "runtime") return (a.runtime - b.runtime) * order;
      if (sort === "rating") return ((a.vote_average || 0) - (b.vote_average || 0)) * order;
      if (sort === "release")
        return (new Date(a.release_date) - new Date(b.release_date)) * order;
      return (a.title || "").localeCompare(b.title || "") * order;
    });

    res.json(movieDetails);
  } catch (err) {
    console.error("❌ Failed to fetch watchlist", err);
    res.status(500).json({ error: "Could not fetch full movie data from watchlist" });
  }
});

module.exports = router;
