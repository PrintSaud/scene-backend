const express = require("express");
const Log = require("../models/log");
const User = require("./models/user");     // adjust path
const app = express();

app.get("/review/:id", async (req, res) => {
  try {
    const review = await Review.findById(req.params.id).populate("user");
    if (!review) return res.status(404).send("Review not found");

    const username = review.user?.username || "Scene User";
    const stars = "★".repeat(Math.round(review.rating || 0));
    const description = review.review || "Check out this review on Scene!";
    const backdrop =
      review.backdropUrl ||
      "https://scenesa.com/default-backdrop.jpg";

    const fullUrl = `https://scenesa.com/review/${review._id}`;

    const html = `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <title>${username} ${stars} – Scene</title>

          <!-- ✅ Open Graph -->
          <meta property="og:title" content="${username} ${stars} – Scene" />
          <meta property="og:description" content="${description}" />
          <meta property="og:image" content="${backdrop}" />
          <meta property="og:url" content="${fullUrl}" />
          <meta property="og:type" content="article" />

          <!-- ✅ Twitter -->
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content="${username} ${stars} – Scene" />
          <meta name="twitter:description" content="${description}" />
          <meta name="twitter:image" content="${backdrop}" />

          <!-- ✅ Fallback -->
          <meta name="theme-color" content="#000000" />
        </head>
        <body>
          <div id="root"></div>
          <script src="/main.js"></script>
        </body>
      </html>
    `;

    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});
