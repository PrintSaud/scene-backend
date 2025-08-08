// 📁 routes/ogRoutes.js
const express = require("express");
const router = express.Router();
const Log = require("../models/log");
const Movie = require('../models/movieModel');

// ✅ backend route: /og/review/:id
router.get("/og/review/:id", async (req, res) => {
    const { id } = req.params;
    const TMDB_IMG = "https://image.tmdb.org/t/p/original";
    const fallbackImage = "https://scenesa.com/scene-og-review-fallback.png";
  
    function renderStars(rating) {
      const full = Math.floor(rating);
      const half = rating % 1 >= 0.5 ? "½" : "";
      return "⭐".repeat(full) + half;
    }
  
    const log = await Log.findById(id).populate("user").populate("movie");
  
    if (!log) {
      return res.send(`
        <html>
          <head>
            <meta property="og:title" content="Review not found" />
            <meta property="og:description" content="This review doesn’t exist." />
            <meta property="og:image" content="${fallbackImage}" />
          </head>
          <body></body>
        </html>
      `);
    }
  
    const title = `@${log.user.username}'s Review – ${renderStars(log.rating || 0)}`;
    const description = log.review || "Check out what they thought about the movie!";
    const backdrop =
      log.customBackdrop ||
      (log.reviewBackdrop ? `${TMDB_IMG}${log.reviewBackdrop}` : "") ||
      (log.movie?.backdrop_path ? `${TMDB_IMG}${log.movie.backdrop_path}` : "") ||
      fallbackImage;
  
    return res.send(`
      <html>
        <head>
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
  });
  
  

module.exports = router;
