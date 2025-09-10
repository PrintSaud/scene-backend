// 📁 routes/ogRoutes.js
const express = require("express");
const path = require("path");
const router = express.Router();
const Log = require("../models/log");

const TMDB_IMG = "https://image.tmdb.org/t/p/original";
const FALLBACK_IMAGE = "https://scenesa.com/scene-og-review-fallback.png";

// Detect crawlers (Twitter, Discord, FB, etc.)
const BOT_UA = /(facebookexternalhit|Twitterbot|Discordbot|LinkedInBot|Slackbot|WhatsApp)/i;

// Escape strings safely for HTML attributes
function esc(str = "") {
  return String(str).replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// Render stars as emojis (rounded halves)
function renderStars(rating = 0) {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5 ? "½" : "";
  return "⭐".repeat(full) + half;
}

router.get("/review/:id", async (req, res) => {
  const { id } = req.params;
  const ua = req.headers["user-agent"] || "";
  const isBot = BOT_UA.test(ua);

  try {
    const log = await Log.findById(id).populate("user").populate("movie");

    if (!log) {
      const html = `
        <html>
          <head>
            <meta charset="UTF-8">
            <meta property="og:title" content="Review not found" />
            <meta property="og:description" content="This review doesn’t exist." />
            <meta property="og:image" content="${FALLBACK_IMAGE}" />
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content="Review not found" />
            <meta name="twitter:description" content="This review doesn’t exist." />
            <meta name="twitter:image" content="${FALLBACK_IMAGE}" />
          </head>
          <body></body>
        </html>`;
      return res.send(html);
    }

    const movieTitle = esc(log.movie?.title || "Untitled Movie");
    const stars = renderStars(log.rating);
    const username = esc(log.user?.username || "user");

    const backdrop =
      log.customBackdrop ||
      (log.reviewBackdrop ? `${TMDB_IMG}${log.reviewBackdrop}` : "") ||
      FALLBACK_IMAGE;

    const title = `${movieTitle} – ${stars}`;
    const description = `Review by @${username}`;
    const fullUrl = `https://scenesa.com/review/${id}`;

    // 🎯 If bot → send OG tags
    if (isBot) {
      const html = `
        <html>
          <head>
            <meta charset="UTF-8" />

            <!-- 🌐 Open Graph -->
            <meta property="og:title" content="${title}" />
            <meta property="og:description" content="${description}" />
            <meta property="og:image" content="${backdrop}" />
            <meta property="og:type" content="article" />
            <meta property="og:url" content="${fullUrl}" />

            <!-- 🐦 Twitter -->
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content="${title}" />
            <meta name="twitter:description" content="${description}" />
            <meta name="twitter:image" content="${backdrop}" />

            <meta name="theme-color" content="#000000" />
          </head>
          <body>Preview for bots</body>
        </html>`;
      return res.send(html);
    }

    // 🎬 If human → just load SPA
    return res.sendFile(path.resolve(__dirname, "../../dist/index.html"));
  } catch (error) {
    console.error("❌ OG route error:", error);

    const html = `
      <html>
        <head>
          <meta charset="UTF-8" />
          <meta property="og:title" content="Error loading review" />
          <meta property="og:description" content="Something went wrong." />
          <meta property="og:image" content="${FALLBACK_IMAGE}" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content="Error loading review" />
          <meta name="twitter:description" content="Something went wrong." />
          <meta name="twitter:image" content="${FALLBACK_IMAGE}" />
        </head>
        <body></body>
      </html>`;
    return res.send(html);
  }
});

module.exports = router;
