const express = require('express');
const router = express.Router();
const multer = require('multer');
const Papa = require('papaparse');
const axios = require('axios');
const Log = require('../models/log');
const Movie = require('../models/movieModel');
const protect = require('../middleware/authMiddleware');

const storage = multer.memoryStorage();
const upload = multer({ storage });

// POST /api/import/letterboxd/diary
router.post('/letterboxd/diary', protect, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  
      const csv = req.file.buffer.toString('utf-8');
  
      // Parse CSV
      const { data } = Papa.parse(csv, {
        header: true,
        skipEmptyLines: true,
      });
  
      let imported = 0;
      for (const row of data) {
        const title = row.Name?.trim();
        const year = parseInt(row.Year);
        const rating = parseFloat(row.Rating) || 0;
        const watchedAt = row['Watched Date'] ? new Date(row['Watched Date']) : new Date();
        const rewatch = row.Rewatch === 'Yes';
  
        if (!title || !year) continue;
  
        // Search TMDB
        const tmdbRes = await axios.get(`https://api.themoviedb.org/3/search/movie`, {
          params: {
            api_key: process.env.TMDB_API_KEY,
            query: title,
            year,
          },
        });
  
        const movieData = tmdbRes.data.results?.[0];
        if (!movieData) continue;
  
        // ✅ Make sure it's in your DB
        let movie = await Movie.findOne({ tmdbId: movieData.id });
        if (!movie) {
          movie = await Movie.create({
            tmdbId: movieData.id,
            title: movieData.title,
            posterPath: movieData.poster_path,
            releaseDate: movieData.release_date,
          });
        }
  
        // ✅ Log using real Mongo ID
        await Log.create({
          user: req.user._id,
          movie: movie._id,
          rating,
          rewatch,
          watchedAt,
          title: movie.title,
          poster: movie.posterPath,
        });
  
        imported++;
      }
  
      res.json({ message: `✅ Successfully imported ${imported} films from diary!` });
  
    } catch (err) {
      console.error('❌ Diary import failed:', err);
      res.status(500).json({ message: 'Import failed', error: err.message });
    }
  });
   
  router.post('/letterboxd/watchlist', protect, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  
      const csv = req.file.buffer.toString('utf-8');
      const { data } = Papa.parse(csv, { header: true, skipEmptyLines: true });
  
      let added = 0;
      const user = await User.findById(req.user._id);
  
      for (const row of data) {
        const title = row.Name?.trim();
        const year = parseInt(row.Year);
        if (!title || !year) continue;
  
        const tmdbRes = await axios.get(`https://api.themoviedb.org/3/search/movie`, {
          params: {
            api_key: process.env.TMDB_API_KEY,
            query: title,
            year,
          },
        });
  
        const movieData = tmdbRes.data.results?.[0];
        if (!movieData) continue;
  
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
  
      let created = 0;
      for (const row of data) {
        const title = row.Name?.trim();
        const year = parseInt(row.Year);
        const rating = parseFloat(row.Rating) || 0;
        if (!title || !year || rating === 0) continue;
  
        const tmdbRes = await axios.get(`https://api.themoviedb.org/3/search/movie`, {
          params: {
            api_key: process.env.TMDB_API_KEY,
            query: title,
            year,
          },
        });
  
        const movieData = tmdbRes.data.results?.[0];
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
          rating,
          watchedAt: new Date(),
          title: movie.title,
          poster: movie.posterPath,
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
  
      let count = 0;
  
      for (const row of data) {
        const title = row.Name?.trim();
        const year = parseInt(row.Year);
        const review = row.Review?.trim();
        const rating = parseFloat(row.Rating) || 0;
        if (!title || !year || !review) continue;
  
        const tmdbRes = await axios.get(`https://api.themoviedb.org/3/search/movie`, {
          params: {
            api_key: process.env.TMDB_API_KEY,
            query: title,
            year,
          },
        });
  
        const movieData = tmdbRes.data.results?.[0];
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
          rating,
          review,
          watchedAt: new Date(),
          title: movie.title,
          poster: movie.posterPath,
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
