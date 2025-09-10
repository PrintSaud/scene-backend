// 📁 routes/ogRoutes.js
const express = require("express");
const path = require("path");
const router = express.Router();
const Log = require("../models/log");

const TMDB_IMG = "https://image.tmdb.org/t/p/original";
const FALLBACK_IMAGE = "https://scenesa.com/scene-og-review-fallback.png";

// ✅ broader crawler detection (FB/IG/WA share use Facebook crawler)
const BOT_UA = /(facebookexternalhit|Facebot|Twitterbot|Discordbot|LinkedInBot|Slackbot|WhatsApp|TelegramBot|Pinterest|SkypeUriPreview|Viber|Snapchat|Google-InspectionTool|Google-Structured-Data-Testing-Tool)/i;

const isBotRequest = (req) => BOT_UA.test(req.headers["user-agent"] || "");

// simple esc for HTML attr
const esc = (s = "") => String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;");

// ⭐ render stars (supports halves)
const renderStars = (rating = 0) => {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5 ? "½" : "";
  return "⭐".repeat(full) + half;
};

// Build review OG HTML
async function buildReviewHtml(id) {
  const log = await Log.findById(id).populate("user").populate("movie");

  if (!log) {
    return {
      status: 200,
      html: `<!doctype html><html><head>
        <meta charset="UTF-8">
        <meta property="og:title" content="Review not found" />
        <meta property="og:description" content="This review doesn’t exist." />
        <meta property="og:image" content="${FALLBACK_IMAGE}" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Review not found" />
        <meta name="twitter:description" content="This review doesn’t exist." />
        <meta name="twitter:image" content="${FALLBACK_IMAGE}" />
      </head><body></body></html>`,
    };
  }

  const movieTitle =
    esc(log.movieTitle || log.movie?.title || log.title || "Untitled Movie");
  const username = esc(log.user?.username || "user");
  const stars = renderStars(typeof log.rating === "number" ? log.rating : 0);

  // Prefer your chosen/review backdrop; support absolute or TMDB paths
  let backdrop =
    log.customBackdrop ||
    log.customBackdropUrl ||
    (log.reviewBackdrop
      ? (String(log.reviewBackdrop).startsWith("http")
          ? log.reviewBackdrop
          : `${TMDB_IMG}${log.reviewBackdrop}`)
      : null) ||
    (log.backdropPath ? `${TMDB_IMG}${log.backdropPath}` : null) ||
    (log.movie?.backdrop_path ? `${TMDB_IMG}${log.movie.backdrop_path}` : null) ||
    FALLBACK_IMAGE;

  // Enforce https scheme
  if (backdrop && backdrop.startsWith("//")) backdrop = "https:" + backdrop;

  const title = `${movieTitle} – ${stars}`;
  const description = `Review by @${username}`;
  const fullUrl = `https://scenesa.com/review/${id}`;

  const html = `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>${title}</title>

      <!-- 🌐 Open Graph -->
      <meta property="og:title" content="${title}" />
      <meta property="og:description" content="${description}" />
      <meta property="og:image" content="${esc(backdrop)}" />
      <meta property="og:type" content="article" />
      <meta property="og:url" content="${fullUrl}" />

      <!-- 🐦 Twitter -->
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="${title}" />
      <meta name="twitter:description" content="${description}" />
      <meta name="twitter:image" content="${esc(backdrop)}" />

      <meta name="theme-color" content="#000000" />
    </head>
    <body>Preview for crawlers.</body>
  </html>`;

  return { status: 200, html };
}

// 🔔 health/ping to verify routing reaches backend
router.get("/og/ping", (req, res) => {
  res.type("text/plain").send("og routes are live ✅");
});

// Respond to both GET and HEAD for crawlers that probe with HEAD
async function handleReview(req, res) {
  const { id } = req.params;
  try {
    if (isBotRequest(req)) {
      const { status, html } = await buildReviewHtml(id);
      // small cache to help FB/WA
      res.set("Cache-Control", "public, max-age=300");
      res.status(status).type("text/html; charset=utf-8").send(html);
      return;
    }
    // Humans → SPA
    res.sendFile(path.resolve(__dirname, "../../dist/index.html"));
  } catch (error) {
    console.warn("❌ OG route error:", error?.message || error);
    res
      .status(200)
      .type("text/html; charset=utf-8")
      .send(`<!doctype html><html><head>
        <meta charset="UTF-8" />
        <meta property="og:title" content="Error loading review" />
        <meta property="og:description" content="Something went wrong." />
        <meta property="og:image" content="${FALLBACK_IMAGE}" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Error loading review" />
        <meta name="twitter:description" content="Something went wrong." />
        <meta name="twitter:image" content="${FALLBACK_IMAGE}" />
      </head><body></body></html>`);
  }
}

router.get("/review/:id", handleReview);
router.head("/review/:id", handleReview);

module.exports = router;
