const express = require("express");
const router = express.Router();
const HomeBanner = require("../models/HomeBanner");

// GET active home banners
router.get("/home", async (req, res) => {
  try {
    const now = new Date();

    const banners = await HomeBanner.find({
      isActive: true,
      $and: [
        {
          $or: [
            { startAt: null },
            { startAt: { $exists: false } },
            { startAt: { $lte: now } },
          ],
        },
        {
          $or: [
            { endAt: null },
            { endAt: { $exists: false } },
            { endAt: { $gte: now } },
          ],
        },
      ],
    }).sort({ priority: 1, createdAt: -1 });

    res.json(banners);
  } catch (err) {
    console.error("❌ Failed to fetch home banners:", err);
    res.status(500).json({ error: "Failed to fetch home banners" });
  }
});

// TEMP admin-style route to create a banner quickly
router.post("/home", async (req, res) => {
  try {
    const banner = await HomeBanner.create(req.body);
    res.status(201).json(banner);
  } catch (err) {
    console.error("❌ Failed to create home banner:", err);
    res.status(500).json({ error: "Failed to create home banner" });
  }
});

module.exports = router;