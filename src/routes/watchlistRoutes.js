const express = require("express");
const router = express.Router();
const User = require("../models/user");
const protect = require("../middleware/authMiddleware");
const { getMovieDetails } = require("../services/tmdbService");
const CustomPoster = require("../models/customPoster");

// ✅ Check watchlist status (auth only)
router.get("/status/:movieId", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const movieId = Number(req.params.movieId);
    const inWatchlist = user.watchlist?.some((w) => w.tmdbId === movieId);
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
    const alreadyIn = user.watchlist?.some((w) => w.tmdbId === movieId);

    if (alreadyIn) {
      await User.findByIdAndUpdate(
        userId,
        { $pull: { watchlist: { tmdbId: movieId } } },
        { new: true }
      );
    } else {
      await User.findByIdAndUpdate(
        userId,
        { $push: { watchlist: { tmdbId: movieId, addedAt: new Date() } } },
        { new: true }
      );
    }

    res.json({
      message: alreadyIn ? "Removed from watchlist" : "Added to watchlist",
      inWatchlist: !alreadyIn,
    });
  } catch (err) {
    console.error("Toggle watchlist error:", err);
    res.status(500).json({ error: "Failed to toggle watchlist" });
  }
});

// ✅ Add to watchlist manually (non-auth fallback)
router.post("/:userId/watchlist", async (req, res) => {
  const { userId } = req.params;
  const { tmdbId } = req.body;
  if (!tmdbId) return res.status(400).json({ error: "tmdbId is required" });

  try {
    await User.findByIdAndUpdate(
      userId,
      { $push: { watchlist: { tmdbId, addedAt: new Date() } } },
      { new: true }
    );

    const user = await User.findById(userId);
    let movieDetails = await Promise.all(
      user.watchlist.map((w) => getMovieDetails(w.tmdbId))
    );

    movieDetails = movieDetails.filter(
      (movie) => movie && movie.id && movie.poster_path
    );

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
      { $pull: { watchlist: { tmdbId: Number(tmdbId) } } },
      { new: true }
    );

    res.json(user.watchlist);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not remove from watchlist" });
  }
});

// ✅ Full watchlist GET with filtering/sorting
router.get('/:userId/watchlist', async (req, res) => {
  const { userId } = req.params;
  const sort = req.query.sort || "title";
  const order = req.query.order === "desc" ? -1 : 1;
  const genre = req.query.genre ? Number(req.query.genre) : null;

  try {
    const user = await User.findById(userId);
    if (!user || !user.watchlist)
      return res.status(404).json({ error: "User or watchlist not found" });

    let movieDetails = await Promise.all(
      user.watchlist.map(async (item) => {
        let tmdbId, addedAt;

        if (typeof item === "object" && item.tmdbId) {
          tmdbId = item.tmdbId;
          addedAt = item.addedAt || new Date(0);
        } else {
          tmdbId = item;
          addedAt = new Date(0);
        }

        const movie = await getMovieDetails(tmdbId);
        if (!movie || !movie.id) return null;

        const customPoster = await CustomPoster.findOne({
          userId: userId,
          movieId: { $in: [tmdbId, String(tmdbId)] }
        });

        const posterOverride = customPoster
          ? customPoster.posterUrl
          : movie.poster_path
          ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
          : "/default-poster.jpg";

        return {
          ...movie,
          posterOverride,
          tmdbId: movie.id,
          addedAt
        };
      })
    );

    movieDetails = movieDetails.filter(Boolean);

    // 🔥 Genre filtering here:
    if (genre && !isNaN(genre)) {
      movieDetails = movieDetails.filter(movie =>
        Array.isArray(movie.genres) &&
        movie.genres.some(g => g.id === genre)
      );
    }

    movieDetails.sort((a, b) => {
      if (sort === "added") return (new Date(a.addedAt) - new Date(b.addedAt)) * order;
      if (sort === "runtime") return (a.runtime - b.runtime) * order;
      if (sort === "rating") return ((a.vote_average || 0) - (b.vote_average || 0)) * order;
      if (sort === "release") return (new Date(a.release_date) - new Date(b.release_date)) * order;
      return (a.title || "").localeCompare(b.title || "") * order;
    });

    res.json(movieDetails);
  } catch (err) {
    console.error("❌ Failed to fetch watchlist", err);
    res.status(500).json({ error: "Could not fetch watchlist" });
  }
});


module.exports = router;
