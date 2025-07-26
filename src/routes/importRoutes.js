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

const titlesMatch = (tmdbTitle, inputTitle) => {
    const normalize = (str) =>
      str?.toLowerCase().replace(/[^\w\s]/gi, "").replace(/\s+/g, " ").trim();
  
    return normalize(tmdbTitle) === normalize(inputTitle);
  };
  

// 🔄 Diary Import
router.post("/diary", protect, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
  
      const csv = req.file.buffer.toString("utf-8");
      const { data } = Papa.parse(csv, { header: true, skipEmptyLines: true });
  
      let count = 0;
  
      for (const row of data) {
        const titleRaw = row.Name?.trim();
        const date = row.Date?.trim();
        const rating = parseFloat(row["Rating"]) || 0;
        const rewatch = row.Rewatch === "Yes";
  
        // 🔒 Validate input
        if (!titleRaw || !date || isNaN(new Date(date).getTime())) {
          console.warn("⚠️ Skipping row with invalid title/date:", row);
          continue;
        }
  
        const year = new Date(date).getFullYear();
  
        // 🔍 TMDB search
        const movieData = await findValidTMDBMatch(titleRaw, year);
        if (
          !movieData ||
          !movieData.id ||
          !movieData.title ||
          !movieData.poster_path ||
          isNaN(movieData.id)
        ) {
          console.warn("❌ Invalid TMDB data for:", titleRaw, movieData);
          continue;
        }
  
        // 🎬 Ensure movie exists in DB
        let movie = await Movie.findOne({ tmdbId: movieData.id });
        if (!movie) {
          movie = await Movie.create({
            tmdbId: movieData.id,
            title: movieData.title,
            posterPath: movieData.poster_path,
            releaseDate: movieData.release_date,
          });
          console.log("🎯 Created new movie:", movie.title);
        }
  
        if (!movie || !movie._id || isNaN(movie.tmdbId)) {
          console.warn("❌ Skipping broken movie entry:", movie);
          continue;
        }
  
        // 🧼 Avoid duplicate logs
        const alreadyLogged = await Log.findOne({
          user: req.user._id,
          movie: movie._id,
          watchedAt: new Date(date),
        });
        if (alreadyLogged) {
          console.log(`🔁 Already logged: ${titleRaw}`);
          continue;
        }
  
        // ✅ Create log with tmdbId
        await Log.create({
          user: req.user._id,
          movie: movie._id,
          tmdbId: movie.tmdbId, // ✅ KEY FIX
          title: movie.title,
          poster: movie.posterPath,
          watchedAt: new Date(date),
          rating,
          rewatch,
          importedFrom: "letterboxd",
        });
  
        console.log(`✅ Imported diary: ${titleRaw}`);
        count++;
      }
  
      res.json({ message: `✅ Imported ${count} diary entries` });
    } catch (err) {
      console.error("❌ Diary import failed:", err);
      res.status(500).json({ message: "Import failed", error: err.message });
    }
  });
  
  

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
  
  

  router.post("/ratings", protect, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
  
      const csv = req.file.buffer.toString("utf-8");
      const { data } = Papa.parse(csv, { header: true, skipEmptyLines: true });
  
      let created = 0;
  
      for (const row of data) {
        const titleRaw = row.Name?.trim();
        const year = parseInt(row.Year);
        const rating = parseFloat(row.Rating);
  
        // ❌ Skip any bad data
        if (!titleRaw || isNaN(year) || isNaN(rating) || rating === 0) {
          console.warn("⚠️ Skipping invalid row:", row);
          continue;
        }
  
        // 🔍 Search TMDB
        const movieData = await findValidTMDBMatch(titleRaw, year);
        if (
          !movieData ||
          !movieData.id ||
          !movieData.title ||
          !movieData.poster_path ||
          isNaN(movieData.id)
        ) {
          console.warn("❌ Invalid TMDB match for:", titleRaw, movieData);
          continue;
        }
  
        // 🗃️ Get or create Movie entry
        let movie = await Movie.findOne({ tmdbId: movieData.id });
        if (!movie) {
          movie = await Movie.create({
            tmdbId: movieData.id,
            title: movieData.title,
            posterPath: movieData.poster_path,
            releaseDate: movieData.release_date,
          });
          console.log("🎯 Created new movie:", movie.title);
        }
  
        // 🔁 Skip duplicate import
        const existing = await Log.findOne({
          user: req.user._id,
          movie: movie._id,
          importedFrom: "letterboxd",
          rating: rating,
        });
  
        if (existing) {
          console.log(`🔁 Already logged rating for: ${titleRaw}`);
          continue;
        }
  
        // ✅ Create rating log
        await Log.create({
          user: req.user._id,
          movie: movie._id,
          tmdbId: movie.tmdbId, // ✅ Important for frontend
          title: movie.title,
          poster: movie.posterPath,
          rating,
          watchedAt: new Date(), // Optional default fallback
          importedFrom: "letterboxd",
        });
  
        console.log(`✅ Imported rating for: ${titleRaw}`);
        created++;
      }
  
      res.json({ message: `✅ Imported ${created} ratings!` });
    } catch (err) {
      console.error("❌ Ratings import failed:", err);
      res.status(500).json({ message: "Import failed", error: err.message });
    }
  });
  
  
  router.post("/reviews", protect, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
  
      const csv = req.file.buffer.toString("utf-8");
      const { data } = Papa.parse(csv, { header: true, skipEmptyLines: true });
  
      let count = 0;
  
      for (const row of data) {
        const titleRaw = row.Name?.trim();
        const year = parseInt(row.Year);
        const review = row.Review?.trim();
        const rating = parseFloat(row.Rating) || 0;
  
        // ❌ Skip invalid data
        if (!titleRaw || !review || isNaN(year)) {
          console.warn("⚠️ Skipping row due to missing title/review/year:", row);
          continue;
        }
  
        // 🔍 TMDB lookup
        const movieData = await findValidTMDBMatch(titleRaw, year);
        await delay(200); // ⏳ Throttle to avoid TMDB rate limiting

        if (
          !movieData ||
          !movieData.id ||
          !movieData.title ||
          !movieData.poster_path ||
          isNaN(movieData.id)
        ) {
          console.warn("❌ Invalid TMDB match for:", titleRaw, movieData);
          continue;
        }
  
        // 🗃️ Get or create Movie
        let movie = await Movie.findOne({ tmdbId: movieData.id });
        if (!movie) {
          movie = await Movie.create({
            tmdbId: movieData.id,
            title: movieData.title,
            posterPath: movieData.poster_path,
            releaseDate: movieData.release_date,
          });
          console.log("🎯 Created new movie:", movie.title);
        }
  
        // 🔁 Avoid duplicates
        const existing = await Log.findOne({
          user: req.user._id,
          movie: movie._id,
          review,
          importedFrom: "letterboxd",
        });
  
        if (existing) {
          console.log(`🔁 Already logged review for: ${titleRaw}`);
          continue;
        }
  
        // ✅ Create review log
// ✅ Create review log
await Log.create({
    user: req.user._id,
    tmdbId: movie.tmdbId,        // ✅ REQUIRED
    title: movie.title,
    poster: movie.posterPath,
    review,
    rating,
    watchedAt: new Date(),       // or row.Date if available
    importedFrom: "letterboxd",  // optional tag
  });
  
  
        console.log(`✅ Imported review for: ${titleRaw}`);
        count++;
      }
  
      res.json({ message: `✅ Imported ${count} full reviews!` });
    } catch (err) {
      console.error("❌ Review import failed:", err);
      res.status(500).json({ message: "Import failed", error: err.message });
    }
  });
  
  
module.exports = router;
