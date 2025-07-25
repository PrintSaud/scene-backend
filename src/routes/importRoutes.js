const express = require('express');
const router = express.Router();
const multer = require('multer');
const Papa = require('papaparse');
const axios = require('axios');
const Log = require('../models/log');
const Movie = require('../models/movieModel');
const User = require('../models/user');
const protect = require('../middleware/authMiddleware');

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
  
      const normalize = (str) =>
        str?.toLowerCase().replace(/[^\w\s]/gi, "").replace(/\s+/g, " ").trim();
  
      let count = 0;
  
      for (const row of data) {
        const titleRaw = row.Name?.trim();
        const date = row.Date?.trim();
        const rating = parseFloat(row["Rating"]) || 0;
        const rewatch = row.Rewatch === "Yes";
  
        if (!titleRaw || !date) continue;
  
        const queryTitle = normalize(titleRaw);
        const year = new Date(date).getFullYear();
  
        const tmdbRes = await axios.get("https://api.themoviedb.org/3/search/movie", {
          params: {
            api_key: process.env.TMDB_API_KEY,
            query: titleRaw,
            year,
          },
        });
  
        const movieData =
          tmdbRes.data.results?.find(
            (m) =>
              normalize(m.title) === queryTitle &&
              m.release_date?.startsWith(year.toString())
          ) ||
          tmdbRes.data.results?.find((m) => normalize(m.title) === queryTitle) ||
          tmdbRes.data.results?.find((m) => normalize(m.original_title) === queryTitle);
  
        if (!movieData) {
          console.log("❌ No match for:", titleRaw);
          continue;
        }
  
        let movie = await Movie.findOne({ tmdbId: movieData.id });
        if (!movie) {
          movie = await Movie.create({
            tmdbId: movieData.id,
            title: movieData.title,
            posterPath: movieData.poster_path,
            releaseDate: movieData.release_date,
          });
        }
  
        // OPTIONAL: Skip if already logged
        const alreadyLogged = await Log.findOne({
          user: req.user._id,
          movie: movie._id,
          watchedAt: new Date(date),
        });
        if (alreadyLogged) continue;
  
        await Log.create({
          user: req.user._id,
          movie: movie._id,
          title: movie.title,
          poster: movie.posterPath,
          watchedAt: new Date(date),
          rating,
          rewatch,
          importedFrom: "letterboxd",
        });
  
        console.log(`✅ Imported: ${titleRaw}`);
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
  
      const normalize = (str) =>
        str?.toLowerCase().replace(/[^\w\s]/gi, "").replace(/\s+/g, " ").trim();
  
      let added = 0;
      const user = await User.findById(req.user._id);
  
      for (const row of data) {
        const titleRaw = row.Name?.trim();
        const year = parseInt(row.Year);
  
        if (!titleRaw || isNaN(year)) {
          console.warn("⚠️ Skipping row due to missing title/year:", row);
          continue;
        }
  
        const titleNorm = normalize(titleRaw);
  
        const tmdbRes = await axios.get("https://api.themoviedb.org/3/search/movie", {
          params: {
            api_key: process.env.TMDB_API_KEY,
            query: titleRaw,
            year,
          },
        });
  
        const movieData =
          tmdbRes.data.results?.find(
            (m) =>
              normalize(m.title) === titleNorm &&
              m.release_date?.startsWith(year.toString())
          ) ||
          tmdbRes.data.results?.find((m) => normalize(m.title) === titleNorm) ||
          tmdbRes.data.results?.find((m) => normalize(m.original_title) === titleNorm);
  
        if (!movieData || !movieData.id) {
          console.warn("❌ No match for:", titleRaw);
          continue;
        }
  
        const alreadyExists = user.watchlist.some(
          (item) => item.tmdbId === movieData.id
        );
  
        if (!alreadyExists) {
          user.watchlist.push({
            tmdbId: movieData.id,
            addedAt: new Date(),
          });
          console.log(`✅ Added to watchlist: ${titleRaw}`);
          added++;
        } else {
          console.log(`🔁 Already in watchlist: ${titleRaw}`);
        }
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
  
      const normalize = (str) =>
        str?.toLowerCase().replace(/[^\w\s]/gi, "").replace(/\s+/g, " ").trim();
  
      let created = 0;
  
      for (const row of data) {
        const titleRaw = row.Name?.trim();
        const year = parseInt(row.Year);
        const rating = parseFloat(row.Rating);
  
        if (!titleRaw || isNaN(year) || isNaN(rating) || rating === 0) {
          console.warn("⚠️ Skipping invalid row:", row);
          continue;
        }
  
        const normalizedTitle = normalize(titleRaw);
  
        const tmdbRes = await axios.get("https://api.themoviedb.org/3/search/movie", {
          params: {
            api_key: process.env.TMDB_API_KEY,
            query: titleRaw,
            year,
          },
        });
  
        const movieData =
          tmdbRes.data.results?.find(
            (m) =>
              normalize(m.title) === normalizedTitle &&
              m.release_date?.startsWith(year.toString())
          ) ||
          tmdbRes.data.results?.find((m) => normalize(m.title) === normalizedTitle) ||
          tmdbRes.data.results?.find((m) => normalize(m.original_title) === normalizedTitle);
  
        if (!movieData || !movieData.id) {
          console.warn("❌ No match for:", titleRaw);
          continue;
        }
  
        let movie = await Movie.findOne({ tmdbId: movieData.id });
        if (!movie) {
          movie = await Movie.create({
            tmdbId: movieData.id,
            title: movieData.title,
            posterPath: movieData.poster_path,
            releaseDate: movieData.release_date,
          });
        }
  
        const existing = await Log.findOne({
          user: req.user._id,
          movie: movie._id,
          importedFrom: "letterboxd",
        });
  
        if (existing) {
          console.log(`🔁 Already logged: ${titleRaw}`);
          continue;
        }
  
        await Log.create({
          user: req.user._id,
          movie: movie._id,
          rating,
          watchedAt: new Date(),
          title: movie.title,
          poster: movie.posterPath,
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
  
      const normalize = (str) =>
        str?.toLowerCase().replace(/[^\w\s]/gi, "").replace(/\s+/g, " ").trim();
  
      let count = 0;
  
      for (const row of data) {
        const titleRaw = row.Name?.trim();
        const year = parseInt(row.Year);
        const review = row.Review?.trim();
        const rating = parseFloat(row.Rating) || 0;
  
        if (!titleRaw || !review || isNaN(year)) {
          console.warn("⚠️ Skipping row due to missing title/review/year:", row);
          continue;
        }
  
        const normTitle = normalize(titleRaw);
  
        const tmdbRes = await axios.get("https://api.themoviedb.org/3/search/movie", {
          params: {
            api_key: process.env.TMDB_API_KEY,
            query: titleRaw,
            year,
          },
        });
  
        const movieData =
          tmdbRes.data.results?.find(
            (m) =>
              normalize(m.title) === normTitle &&
              m.release_date?.startsWith(year.toString())
          ) ||
          tmdbRes.data.results?.find((m) => normalize(m.title) === normTitle) ||
          tmdbRes.data.results?.find((m) => normalize(m.original_title) === normTitle);
  
        if (!movieData || !movieData.id) {
          console.warn("❌ No match for:", titleRaw);
          continue;
        }
  
        let movie = await Movie.findOne({ tmdbId: movieData.id });
        if (!movie) {
          movie = await Movie.create({
            tmdbId: movieData.id,
            title: movieData.title,
            posterPath: movieData.poster_path,
            releaseDate: movieData.release_date,
          });
        }
  
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
  
        await Log.create({
          user: req.user._id,
          movie: movie._id,
          title: movie.title,
          poster: movie.posterPath,
          review,
          rating,
          watchedAt: new Date(),
          importedFrom: "letterboxd",
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
