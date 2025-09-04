// src/routes/watchlist.js

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

// ✅ Toggle watchlist (auth only) — now auto-cleaning malformed entries
router.post("/toggle", protect, async (req, res) => {
  const { movieId } = req.body;
  const userId = req.user._id;

  try {
    const user = await User.findById(userId);  // <-- define first
    if (!user) return res.status(404).json({ error: "User not found" });

    console.log("User before push:", user.watchlist); // <-- safe now

    // 🧹 Clean malformed entries
    user.watchlist = user.watchlist.filter(
      (w) => typeof w === "object" && w.tmdbId
    );
    await user.save();

    const alreadyIn = user.watchlist?.some((w) => w.tmdbId === movieId);

    if (alreadyIn) {
      await User.findByIdAndUpdate(
        userId,
        { $pull: { watchlist: { tmdbId: movieId } } },
        { new: true }
      );
      return res.json({ message: "Removed from watchlist", inWatchlist: false });
    } else {
      const details = await getMovieDetails(movieId);
      await User.findByIdAndUpdate(
        userId,
        {
          $push: {
            watchlist: {
              tmdbId: movieId,
              poster_path: details?.poster_path || null,
              title: details?.title || null,
              release_date: details?.release_date || null,
              addedAt: new Date(),
            },
          },
        },
        { new: true }
      );
      return res.json({ message: "Added to watchlist", inWatchlist: true });
    }
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
    let cleanedWatchlist = user.watchlist.filter((item) => typeof item === "object" && item.tmdbId);

    let movieDetails = await Promise.all(
      cleanedWatchlist.map((w) => getMovieDetails(w.tmdbId))
    );

    movieDetails = movieDetails.filter((movie) => movie && movie.id && movie.poster_path);

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



// ✅ Fast Watchlist (no TMDB calls)
// ✅ Fast Watchlist (always returns poster_path)
router.get("/:userId/watchlist", async (req, res) => {
  const { userId } = req.params;
  const sort = req.query.sort || "added";
  const order = req.query.order === "desc" ? -1 : 1;
  const genre = req.query.genre ? Number(req.query.genre) : null;

  try {
    const user = await User.findById(userId).lean();
    if (!user || !user.watchlist) {
      return res.status(404).json({ error: "User or watchlist not found" });
    }

    // Clean: only objects with tmdbId
    let movies = user.watchlist.filter((w) => typeof w === "object" && w.tmdbId);

    // 🎬 Genre filter (if you store genres locally)
    if (genre && !isNaN(genre)) {
      movies = movies.filter(
        (m) => Array.isArray(m.genres) && m.genres.some((g) => g.id === genre)
      );
    }

    // Sort
    movies.sort((a, b) => {
      if (sort === "added") return (new Date(a.addedAt) - new Date(b.addedAt)) * order;
      if (sort === "runtime") return ((a.runtime || 0) - (b.runtime || 0)) * order;
      if (sort === "rating") return ((a.vote_average || 0) - (b.vote_average || 0)) * order;
      if (sort === "release") return (new Date(a.release_date) - new Date(b.release_date)) * order;
      return (a.title || "").localeCompare(b.title || "") * order;
    });

    // 🎨 Custom posters
    const customPosters = await CustomPoster.find({
      userId,
      movieId: { $in: movies.map((m) => String(m.tmdbId)) },
    }).lean();

    const postersMap = {};
    customPosters.forEach((cp) => {
      postersMap[cp.movieId] = cp.posterUrl;
    });

    // 🔍 Enrich missing poster_path using TMDB
    let enrichedMovies = await Promise.all(
      movies.map(async (m) => {
        let poster_path = m.poster_path || null;
        let title = m.title || null;
        let release_date = m.release_date || null;

        if (!poster_path) {
          try {
            const details = await getMovieDetails(m.tmdbId);
            poster_path = details?.poster_path || null;
            title = title || details?.title || null;
            release_date = release_date || details?.release_date || null;
          } catch (err) {
            console.warn("⚠️ Failed to fetch TMDB details for", m.tmdbId);
          }
        }

        return {
          ...m,
          posterOverride: postersMap[m.tmdbId] || null,
          poster_path,
          title,
          release_date,
        };
      })
    );

    res.json(enrichedMovies);
  } catch (err) {
    console.error("❌ Failed to fetch watchlist", err);
    res.status(500).json({ error: "Could not fetch watchlist" });
  }
});



module.exports = router;
