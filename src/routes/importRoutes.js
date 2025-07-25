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

// Strict fuzzy matcher
const titlesMatch = (tmdbTitle, inputTitle) => {
    return tmdbTitle.toLowerCase().trim() === inputTitle.toLowerCase().trim();
  };

// 🔄 Diary Import
router.post("/diary", protect, upload.single("file"), async (req, res) => {
    
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const csv = req.file.buffer.toString("utf-8");
      const { data } = Papa.parse(csv, { header: true, skipEmptyLines: true });
  
      let count = 0;
  
      for (const row of data) {
        const title = row.Name?.trim();
        const date = row.Date?.trim();
        const rating = parseFloat(row["Rating"]) || 0;
        const rewatch = row.Rewatch === "Yes";
  
        if (!title || !date) continue;
  
        const tmdbRes = await axios.get("https://api.themoviedb.org/3/search/movie", {
          params: {
            api_key: process.env.TMDB_API_KEY,
            query: title,
          },
        });
  
        const movieData = tmdbRes.data.results.find((movie) => titlesMatch(movie.title, title));
        if (!movieData) continue;
  
        let movie = await Movie.findOne({ tmdbId: movieData.id });
        if (!movie) {
          movie = await Movie.create({
            tmdbId: movieData.id,
            title: movieData.title,
            posterPath: movieData.poster_path,
            releaseDate: movieData.release_date,
          });
        }
  
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
  
        count++;
      }
  
      res.json({ message: `✅ Imported ${count} diary entries` });
    } catch (err) {
      console.error("❌ Diary import failed:", err);
      res.status(500).json({ message: "Import failed", error: err.message });
    }
  });
  
  router.post('/letterboxd/watchlist', protect, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  
      const csv = req.file.buffer.toString('utf-8');
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
  
        const title = normalize(titleRaw);
  
        const tmdbRes = await axios.get(`https://api.themoviedb.org/3/search/movie`, {
          params: {
            api_key: process.env.TMDB_API_KEY,
            query: titleRaw,
            year,
          },
        });
  
        const movieData = tmdbRes.data.results?.find(
          (m) => normalize(m.title) === title
        );
  
        if (!movieData || !movieData.id) {
          console.warn("⚠️ Movie not found or missing ID for:", titleRaw);
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
          added++;
        }
      }
  
      await user.save();
      res.json({ message: `✅ Added ${added} movies to your watchlist!` });
  
    } catch (err) {
      console.error('❌ Watchlist import failed:', err);
      res.status(500).json({ message: 'Import failed', error: err.message });
    }
  });
  
  
  

  router.post('/letterboxd/ratings', protect, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  
      const csv = req.file.buffer.toString('utf-8');
      const { data } = Papa.parse(csv, { header: true, skipEmptyLines: true });
  
      const normalize = (str) =>
        str?.toLowerCase().replace(/[^\w\s]/gi, "").replace(/\s+/g, " ").trim();
  
      let created = 0;
  
      for (const row of data) {
        const titleRaw = row.Name;
        const title = titleRaw?.trim();
        const year = parseInt(row.Year);
        const rating = parseFloat(row.Rating) || 0;
  
        if (!title || !year || rating === 0) continue;
  
        const normalized = normalize(title);
  
        const tmdbRes = await axios.get(`https://api.themoviedb.org/3/search/movie`, {
          params: {
            api_key: process.env.TMDB_API_KEY,
            query: title,
            year,
          },
        });
  
        let movieData = tmdbRes.data.results?.find(
          (m) => normalize(m.title) === normalized && m.release_date?.startsWith(year.toString())
        );
  
        // Fallback: match without year
        if (!movieData) {
          movieData = tmdbRes.data.results?.find(
            (m) => normalize(m.title) === normalized
          );
        }
  
        if (!movieData) continue;
  
        let movie = await Movie.findOne({ tmdbId: movieData.id });
        if (!movie) {
          movie = await Movie.create({
            tmdbId: movieData.id,
            title: movieData.title,
            posterPath: movieData.poster_path,
            releaseDate: movieData.release_date,
          });
        }
  
        const existingLog = await Log.findOne({
          user: req.user._id,
          movie: movie._id,
          importedFrom: "letterboxd"
        });
  
        if (existingLog) continue;
  
        await Log.create({
          user: req.user._id,
          movie: movie._id,
          rating,
          watchedAt: new Date(),
          title: movie.title,
          poster: movie.posterPath,
          importedFrom: "letterboxd"
        });
  
        created++;
      }
  
      res.json({ message: `✅ Imported ${created} ratings!` });
    } catch (err) {
      console.error('❌ Ratings import failed:', err);
      res.status(500).json({ message: 'Import failed', error: err.message });
    }
  });

  router.post('/letterboxd/reviews', protect, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  
      const csv = req.file.buffer.toString('utf-8');
      const { data } = Papa.parse(csv, { header: true, skipEmptyLines: true });
  
      const normalize = (str) =>
        str?.toLowerCase().replace(/[^\w\s]/gi, "").replace(/\s+/g, " ").trim();
  
      let count = 0;
  
      for (const row of data) {
        const titleRaw = row.Name;
        const title = titleRaw?.trim();
        const year = parseInt(row.Year);
        const review = row.Review?.trim();
        const rating = parseFloat(row.Rating) || 0;
  
        if (!title || !year || !review) continue;
  
        const normalized = normalize(title);
  
        const tmdbRes = await axios.get(`https://api.themoviedb.org/3/search/movie`, {
          params: {
            api_key: process.env.TMDB_API_KEY,
            query: title,
            year,
          },
        });
  
        // 🎯 Strict match first
        let movieData = tmdbRes.data.results?.find(
          (m) => normalize(m.title) === normalized && m.release_date?.startsWith(year.toString())
        );
  
        // Fallback without year match
        if (!movieData) {
          movieData = tmdbRes.data.results?.find(
            (m) => normalize(m.title) === normalized
          );
        }
  
        if (!movieData) continue;
  
        let movie = await Movie.findOne({ tmdbId: movieData.id });
        if (!movie) {
          movie = await Movie.create({
            tmdbId: movieData.id,
            title: movieData.title,
            posterPath: movieData.poster_path,
            releaseDate: movieData.release_date,
          });
        }
  
        // ❌ Prevent duplicate reviews from Letterboxd
        const existing = await Log.findOne({
          user: req.user._id,
          movie: movie._id,
          review,
          importedFrom: "letterboxd",
        });
  
        if (existing) continue;
  
        await Log.create({
          user: req.user._id,
          movie: movie._id,
          rating,
          review,
          watchedAt: new Date(),
          title: movie.title,
          poster: movie.posterPath,
          importedFrom: "letterboxd",
        });
  
        count++;
      }
  
      res.json({ message: `✅ Imported ${count} full reviews!` });
    } catch (err) {
      console.error('❌ Review import failed:', err);
      res.status(500).json({ message: 'Import failed', error: err.message });
    }
  });

module.exports = router;
