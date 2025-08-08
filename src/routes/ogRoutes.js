// 📁 routes/ogRoutes.js
const express = require("express");
const router = express.Router();
const Log = require("../models/log");
const Movie = require('../models/movieModel');

router.get("/review/:id", async (req, res) => {
  const reviewId = req.params.id;

  try {
    const log = await Log.findById(reviewId).populate("user", "username");
    if (!log) return res.status(404).send("Review not found");

    const tmdbId = log.tmdbId;
    const movie = await Movie.findOne({ tmdbId });

    const title = movie?.title || "Unknown Movie";
    const backdrop = movie?.backdrop_path
      ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}`
      : "https://scenesa.com/scene-og-review-fallback.png";

    const rating = log.rating?.toFixed(1) || "No rating";
    const username = log.user?.username || "Someone";

    // 🔥 Send full OG-enabled HTML
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta property="og:type" content="article" />
          <meta property="og:title" content="${title} – Reviewed by @${username}" />
          <meta property="og:description" content="${username} rated it ${rating} stars on Scene." />
          <meta property="og:image" content="${backdrop}" />
          <meta property="og:url" content="https://scenesa.com/review/${log._id}" />

          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content="${title} – Reviewed by @${username}" />
          <meta name="twitter:description" content="${username} rated it ${rating} stars on Scene." />
          <meta name="twitter:image" content="${backdrop}" />

          <title>Scene – Review by @${username}</title>
        </head>
        <body>
          <p>Redirecting to Scene...</p>
          <script>
            window.location.href = "https://scenesa.com/review/${log._id}";
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("❌ OG review error:", err);
    res.status(500).send("Server error");
  }
});

module.exports = router;
