const express = require("express");
const router = express.Router();
const HomeBanner = require("../models/HomeBanner");

const ALLOWED_DESIGNS = ["text", "image", "link", "movie"];

const ALLOWED_ACTIONS = [
  "none",
  "screen",
  "movie",
  "actor",
  "director",
  "cinematographer",
  "url",
];

function normalizeBannerPayload(body = {}) {
  const payload = {
    title: body.title,
    subtitle: body.subtitle,
    image: body.image,
    buttonText: body.buttonText,

    designType: body.designType,
    actionType: body.actionType,
    actionValue: body.actionValue,

    backgroundColor: body.backgroundColor,
    textColor: body.textColor,
    buttonColor: body.buttonColor,
    buttonTextColor: body.buttonTextColor,

    isActive: body.isActive,
    startAt: body.startAt,
    endAt: body.endAt,
    priority: body.priority,
  };

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) delete payload[key];
  });

  if (typeof payload.title === "string") payload.title = payload.title.trim();
  if (typeof payload.subtitle === "string") payload.subtitle = payload.subtitle.trim();
  if (typeof payload.image === "string") payload.image = payload.image.trim();
  if (typeof payload.buttonText === "string") payload.buttonText = payload.buttonText.trim();
  if (typeof payload.actionValue === "string") payload.actionValue = payload.actionValue.trim();

  if (!payload.designType) payload.designType = "text";
  if (!payload.actionType) payload.actionType = "none";

  return payload;
}

function validateBannerPayload(payload, { partial = false } = {}) {
  if (!partial && !payload.title) {
    return "Title is required";
  }

  if (payload.designType && !ALLOWED_DESIGNS.includes(payload.designType)) {
    return "Invalid designType";
  }

  if (payload.actionType && !ALLOWED_ACTIONS.includes(payload.actionType)) {
    return "Invalid actionType";
  }

  if (payload.designType === "image" && !payload.image) {
    return "Image banner requires image";
  }

  if (payload.designType === "link") {
    if (!payload.actionValue) return "Link banner requires actionValue";
    if (!payload.actionType || payload.actionType === "none") {
      return "Link banner requires actionType";
    }
  }

  if (payload.designType === "movie") {
    if (payload.actionType && payload.actionType !== "movie") {
      return "Movie banner actionType must be movie";
    }

    if (!payload.actionValue) {
      return "Movie banner requires actionValue";
    }

    payload.actionType = "movie";
  }

  if (payload.actionType && payload.actionType !== "none" && !payload.actionValue) {
    return "actionValue is required when actionType is not none";
  }

  if (payload.priority !== undefined && Number.isNaN(Number(payload.priority))) {
    return "priority must be a number";
  }

  return null;
}

// GET active home banners
router.get("/home", async (req, res) => {
  try {
    const now = new Date();

    const limit = Math.min(Number(req.query.limit) || 10, 20);

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
    })
      .sort({ priority: 1, createdAt: -1 })
      .limit(limit)
      .lean();

    res.json(banners);
  } catch (err) {
    console.error("❌ Failed to fetch home banners:", err);
    res.status(500).json({ error: "Failed to fetch home banners" });
  }
});

// TEMP admin-style route to create a banner quickly
router.post("/home", async (req, res) => {
  try {
    const payload = normalizeBannerPayload(req.body);
    const validationError = validateBannerPayload(payload);

    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const banner = await HomeBanner.create(payload);

    res.status(201).json(banner);
  } catch (err) {
    console.error("❌ Failed to create home banner:", err);
    res.status(500).json({ error: "Failed to create home banner" });
  }
});

// PATCH update banner
router.patch("/home/:id", async (req, res) => {
  try {
    const payload = normalizeBannerPayload(req.body);
    const validationError = validateBannerPayload(payload, { partial: true });

    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const updated = await HomeBanner.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });

    if (!updated) {
      return res.status(404).json({ error: "Banner not found" });
    }

    res.json(updated);
  } catch (err) {
    console.error("❌ Failed to update banner:", err);
    res.status(500).json({ error: "Failed to update banner" });
  }
});

// DELETE banner by ID
router.delete("/home/:id", async (req, res) => {
  try {
    const banner = await HomeBanner.findByIdAndDelete(req.params.id);

    if (!banner) {
      return res.status(404).json({ error: "Banner not found" });
    }

    res.json({ message: "Banner deleted successfully" });
  } catch (err) {
    console.error("❌ Failed to delete banner:", err);
    res.status(500).json({ error: "Failed to delete banner" });
  }
});

module.exports = router;

