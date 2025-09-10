// 📁 routes/ogRoutes.js
const express = require("express");
const router = express.Router();
const Log = require("../models/log");

router.get("/review/:id", async (req, res) => {
  const { id } = req.params;
  const TMDB_IMG = "https://image.tmdb.org/t/p/original";
  const fallbackImage = "https://scenesa.com/scene-og-review-fallback.png";

  // ✅ Render star emojis
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
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content="Review not found" />
            <meta name="twitter:description" content="This review doesn’t exist." />
            <meta name="twitter:image" content="${fallbackImage}" />
          </head>
          <body></body>
        </html>
      `);
    }

    // 🔥 Always use chosen backdrop (custom or reviewBackdrop) — no default movie backdrop
    const backdrop =
      log.customBackdrop ||
      (log.reviewBackdrop ? `${TMDB_IMG}${log.reviewBackdrop}` : "") ||
      fallbackImage;

    const title = `${log.movie?.title || "Untitled Movie"} – ${renderStars(log.rating)}`;
    const description = `Review by @${log.user?.username || "user"}`;

    return res.send(`
      <html>
        <head>
          <meta charset="UTF-8" />

          <!-- 🌐 Open Graph -->
          <meta property="og:title" content="${title}" />
          <meta property="og:description" content="${description}" />
          <meta property="og:image" content="${backdrop}" />
          <meta property="og:type" content="article" />
          <meta property="og:url" content="https://scenesa.com/review/${id}" />

          <!-- 🐦 Twitter -->
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content="${title}" />
          <meta name="twitter:description" content="${description}" />
          <meta name="twitter:image" content="${backdrop}" />

          <!-- 👤 Human redirect -->
          <meta http-equiv="refresh" content="0; url=https://scenesa.com/review/${id}" />
        </head>
        <body></body>
      </html>
    `);
  } catch (error) {
    console.error("❌ OG route error:", error);
    res.send(`
      <html>
        <head>
          <meta charset="UTF-8" />
          <meta property="og:title" content="Error loading review" />
          <meta property="og:description" content="Something went wrong." />
          <meta property="og:image" content="${fallbackImage}" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content="Error loading review" />
          <meta name="twitter:description" content="Something went wrong." />
          <meta name="twitter:image" content="${fallbackImage}" />
        </head>
        <body></body>
      </html>
    `);
  }
});

module.exports = router;
