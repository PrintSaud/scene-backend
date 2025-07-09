const express = require("express");
const router = express.Router();
const User = require("../models/user");
const protect = require("../middleware/authMiddleware");
const { getMovieDetails } = require("../services/tmdbService");

// Full watchlist GET route
router.get("/:userId/watchlist", async (req, res) => {
  const { userId } = req.params;
  const sort = req.query.sort || "title";
  const order = req.query.order === "desc" ? -1 : 1;

  try {
    const user = await User.findById(userId);
    if (!user || !user.watchlist)
      return res.status(404).json({ error: "User or watchlist not found" });

    let movieDetails = await Promise.all(
      user.watchlist.map(async (tmdbId) => {
        const movie = await getMovieDetails(tmdbId);
        // Ensure it has valid ID and poster_path before returning
        return movie && movie.id && movie.poster_path ? movie : null;
      })
    );

    movieDetails = movieDetails.filter(Boolean); // Remove null or incomplete

    // Optional: log for debug
    console.log("✅ Clean movieDetails:", movieDetails);

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
    res.status(500).json({ error: "Could not fetch watchlist" });
  }
});
