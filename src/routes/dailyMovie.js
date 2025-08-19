// routes/daily.js
const express = require("express");
const router = express.Router();

// ⬇️ use the updated util that exports named fns
const { getDailyMovie, clearDailyCache } = require("../utils/dailyMovie");
const { getPreferredPosterUrl } = require("../utils/tmdbUtils"); // Arabic > English > no-text

router.get("/", async (req, res) => {
  try {
    const force = req.query.refresh === "1"; // /api/daily?refresh=1
    if (force) clearDailyCache();

    // util returns: { date, tmdbId, title, overview, poster_path, backdrop_path, rating, votes }
    const movie = await getDailyMovie({ force });
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

module.exports = router;
