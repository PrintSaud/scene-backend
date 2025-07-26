const express = require('express');
const router = express.Router();
const multer = require('multer');
const Papa = require('papaparse');
const axios = require('axios');
const Log = require('../models/log');
const Movie = require('../models/movieModel');
const User = require('../models/user');
const protect = require('../middleware/authMiddleware');
const { findValidTMDBMatch } = require("../utils/tmdbUtils");

const storage = multer.memoryStorage();
const upload = multer({ storage });

// 🧠 Small delay helper to throttle requests
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const titlesMatch = (tmdbTitle, inputTitle) => {
    const normalize = (str) =>
      str?.toLowerCase().replace(/[^\w\s]/gi, "").replace(/\s+/g, " ").trim();
  
    return normalize(tmdbTitle) === normalize(inputTitle);
  };

  router.post("/watchlist", protect, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
  
      const csv = req.file.buffer.toString("utf-8");
      const { data } = Papa.parse(csv, { header: true, skipEmptyLines: true });
  
      let added = 0;
      const user = await User.findById(req.user._id);
  
      for (const row of data) {
        const titleRaw = row.Name?.trim();
        const year = parseInt(row.Year);
  
        // ❌ Skip broken rows
        if (!titleRaw || isNaN(year)) {
          console.warn("⚠️ Skipping invalid row:", row);
          continue;
        }
  
        // 🔍 TMDB search
        const movieData = await findValidTMDBMatch(titleRaw, year);
        
        if (
          !movieData ||
          !movieData.id ||
          !movieData.title ||
          !movieData.poster_path ||
          isNaN(movieData.id)
        ) {
          console.warn("❌ Invalid TMDB match:", titleRaw, movieData);
          continue;
        }
  
        // 🧼 Check for duplicates
        const alreadyExists = user.watchlist.some(
          (item) => item.tmdbId === movieData.id
        );
  
        if (alreadyExists) {
          console.log(`🔁 Already in watchlist: ${titleRaw}`);
          continue;
        }
  
        // ✅ Push to watchlist (and optionally store preview data)
        user.watchlist.push({
          tmdbId: movieData.id,
          title: movieData.title,               // ✅ optional but helpful
          posterPath: movieData.poster_path,   // ✅ optional but helpful
          addedAt: new Date(),
        });
  
        console.log(`✅ Added to watchlist: ${titleRaw}`);
        added++;
      }
  
      await user.save();
      res.json({ message: `✅ Added ${added} movies to your watchlist!` });
    } catch (err) {
      console.error("❌ Watchlist import failed:", err);
      res.status(500).json({ message: "Import failed", error: err.message });
    }
  });



router.post("/logs", protect, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const csv = req.file.buffer.toString("utf-8");
    const { data } = Papa.parse(csv, { header: true, skipEmptyLines: true });

    const normalize = (str) =>
      str?.toLowerCase().replace(/[^\w\s]/gi, "").replace(/\s+/g, " ").trim();

    const latestLogs = new Map(); // key: normTitle + year, value: latest row

    for (const row of data) {
      const titleRaw = row.Name?.trim();
      const year = parseInt(row.Year);
      const rating = parseFloat(row.Rating) || 0;
      const watchedAt = new Date(row.Date) || new Date();

      if (!titleRaw || isNaN(year)) continue;

      const normTitle = normalize(titleRaw);
      const key = `${normTitle}-${year}`;

      const existing = latestLogs.get(key);
      if (!existing || new Date(watchedAt) > new Date(existing.Date)) {
        latestLogs.set(key, { ...row, Rating: rating });
      }
    }

    let imported = 0;
    for (const row of latestLogs.values()) {
      const titleRaw = row.Name?.trim();
      const year = parseInt(row.Year);
      const rating = parseFloat(row.Rating) || 0;
      const watchedAt = new Date(row.Date) || new Date();

      const movieData = await findValidTMDBMatch(titleRaw, year);
      await delay(200); // TMDB rate limit

      if (!movieData) continue;

      const exists = await Log.findOne({
        user: req.user._id,
        tmdbId: movieData.id,
      });

      if (exists) continue;

      await Log.create({
        user: req.user._id,
        tmdbId: movieData.id,
        title: movieData.title,
        poster: movieData.poster_path,
        rating,
        watchedAt,
      });

      imported++;
    }

    res.status(201).json({ message: `✅ Imported ${imported} logs.` });
  } catch (err) {
    console.error("❌ Import logs error:", err);
    res.status(500).json({ message: "Server error during log import." });
  }
});

module.exports = router;

