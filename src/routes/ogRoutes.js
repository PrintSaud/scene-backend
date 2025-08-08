// 📁 routes/ogRoutes.js
const express = require("express");
const router = express.Router();
const Log = require("../models/log");
const Movie = require("../models/movieModel");

router.get("/review/:id", async (req, res) => {
  const { id } = req.params;
  const TMDB_IMG = "https://image.tmdb.org/t/p/original";
  const fallbackImage = "https://scenesa.com/scene-og-review-fallback.png";

  // ✅ 1. Render proper star emojis
  function renderStars(rating = 0) {
    const fullStars = Math.floor(rating);
    const half = rating % 1 >= 0.5 ? "½" : "";
    return "⭐".repeat(fullStars) + half;
  }

  try {
    const log = await Log.findById(id).populate("user").populate("movie");

    if (!log) {
      return res.send(`
        <html>
          <head>
            <meta charset="UTF-8">
            <meta property="og:title" content="Review not found" />
            <meta property="og:description" content="This review doesn’t exist." />
            <meta property="og:image" content="${fallbackImage}" />
          </head>
          <body></body>
        </html>
      `);
    }

    const title = `@${log.user.username}'s Review – ${renderStars(log.rating)}`;
    const description = log.review
      ? log.review.replace(/["']/g, "") // remove quote issues
      : "Check out what they thought about the movie!";

    // ✅ 2. Choose best backdrop available
    const backdrop =
      log.customBackdrop ||
      (log.reviewBackdrop ? `${TMDB_IMG}${log.reviewBackdrop}` : "") ||
      (log.movie?.backdrop_path ? `${TMDB_IMG}${log.movie.backdrop_path}` : "") ||
      fallbackImage;

    return res.send(`
      <html>
        <head>
          <meta charset="UTF-8">
          <meta property="og:title" content="${title}" />
          <meta property="og:description" content="${description}" />
          <meta property="og:image" content="${backdrop}" />
          <meta property="og:type" content="article" />
          <meta property="og:url" content="https://scenesa.com/review/${id}" />

          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content="${title}" />
          <meta name="twitter:description" content="${description}" />
          <meta name="twitter:image" content="${backdrop}" />
        </head>
        <body></body>
      </html>
    `);
  } catch (error) {
    console.error("❌ OG route error:", error);
    res.send(`
      <html>
        <head>
          <meta charset="UTF-8">
          <meta property="og:title" content="Error loading review" />
          <meta property="og:description" content="Something went wrong." />
          <meta property="og:image" content="${fallbackImage}" />
        </head>
        <body></body>
      </html>
    `);
  }
});

module.exports = router;
