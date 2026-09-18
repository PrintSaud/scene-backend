// routes/dailyMovie.js
const express = require("express");
const router = express.Router();

// ⬇️ use the updated util that exports named fns
const {
  getDailyMovie,
  skipDailyMovie,
  setDailyMovie,
  clearDailyCache,
} = require("../utils/dailyMovie");
const { getPreferredPosterUrl } = require("../utils/tmdbUtils"); // Arabic > English > no-text

router.get("/", async (req, res) => {
  try {
    // Public endpoint only reads today's persisted Movie of the Day.
    // Changing/skipping the movie is restricted to the admin POST routes.
    const movie = await getDailyMovie();
    if (!movie) return res.status(500).json({ message: "Failed to fetch daily movie" });

    // Prefer Arabic poster; fallback to TMDB path
    let poster = null;
    if (movie.tmdbId) {
      try {
        poster = await getPreferredPosterUrl(movie.tmdbId, "w500");
      } catch {}
    }
    if (!poster && movie.poster_path) {
      poster = `https://image.tmdb.org/t/p/w500${movie.poster_path}`;
    }

    const backdrop = movie.backdrop_path
      ? `https://image.tmdb.org/t/p/w780${movie.backdrop_path}`
      : null;

    res.json({
      id: movie.tmdbId,
      title: movie.title,
      overview: movie.overview,
      poster,
      backdrop,
      rating: movie.rating,
      votes: movie.votes,
      date: movie.date, // Riyadh day stamp from the util
    });
  } catch (e) {
    console.error("❌ Daily movie route error:", e);
    res.status(500).json({ message: "Failed to get daily movie" });
  }
});


// =========================================================
// DAILY MOVIE ADMIN CONTROLS
// =========================================================

function requireDailyMovieAdmin(req, res, next) {
  const expected =
    process.env.DAILY_MOVIE_ADMIN_SECRET ||
    process.env.ADMIN_SECRET;

  if (!expected) {
    console.error("Daily movie admin secret is not configured");

    return res.status(503).json({
      success: false,
      error: "Daily movie admin controls are not configured",
    });
  }

  const provided = req.get("x-admin-secret");

  if (!provided || provided !== expected) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized",
    });
  }

  next();
}

// Skip today's current movie and immediately choose another.
router.post("/skip", requireDailyMovieAdmin, async (req, res) => {
  try {
    const previous = await getDailyMovie();
    const movie = await skipDailyMovie();

    return res.json({
      success: true,
      message: "Daily movie skipped",
      previous: {
        tmdbId: previous.tmdbId,
        title: previous.title,
      },
      movie,
    });
  } catch (error) {
    console.error("❌ Failed to skip daily movie:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Failed to skip daily movie",
    });
  }
});

// Manually force any TMDB movie to be today's Movie of the Day.
router.post("/set", requireDailyMovieAdmin, async (req, res) => {
  try {
    const { tmdbId } = req.body || {};

    if (!tmdbId) {
      return res.status(400).json({
        success: false,
        error: "tmdbId is required",
      });
    }

    const movie = await setDailyMovie(tmdbId);

    return res.json({
      success: true,
      message: "Daily movie manually changed",
      movie,
    });
  } catch (error) {
    console.error("❌ Failed to manually set daily movie:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Failed to set daily movie",
    });
  }
});

module.exports = router;
