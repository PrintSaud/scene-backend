const express = require('express');
const router = express.Router();

const {
  searchMovies,
  getMovieDetails,
  getTrendingMovies,
} = require('../services/tmdbService');

const Movie = require('../models/movieModel');

// 🔥 GET /api/movies/trending
router.get('/trending', async (req, res) => {
  try {
    const movies = await getTrendingMovies();
    const formatted = movies.slice(0, 20).map((movie) => ({
      id: movie.id,
      title: movie.title,
      poster: `https://image.tmdb.org/t/p/w500${movie.poster_path}`,
    }));
    res.json(formatted);
  } catch (err) {
    console.error("🔥 Trending fetch error:", err);
    res.status(500).json({ error: "Failed to fetch trending movies." });
  }
});

// 🔍 GET /api/movies/search?q=...
router.get('/search', async (req, res) => {
  try {
    const { q, page } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Query param `q` is required.' });
    }

    const data = await searchMovies(q, page);
    res.json({ results: data.results, totalPages: data.total_pages });
  } catch (err) {
    console.error('🔍 Search error:', err);
    res.status(500).json({ error: 'Failed to search movies.' });
  }
});

// 🎬 GET /api/movies/:tmdbId → returns title + backdrops
router.get('/:tmdbId', async (req, res) => {
  try {
    const tmdbId = parseInt(req.params.tmdbId);
    if (!tmdbId || isNaN(tmdbId)) {
      return res.status(400).json({ error: '❌ Invalid Movie ID' });
    }

    // 1. Fetch full details (includes backdrops)
    const details = await getMovieDetails(tmdbId);

    // 2. Save to DB if not already exists
    let movie = await Movie.findOne({ tmdbId });
    if (!movie) {
      movie = await Movie.create({
        tmdbId: details.id,
        title: details.title,
        overview: details.overview,
        posterPath: details.poster_path,
        releaseDate: details.release_date,
        genres: details.genres.map((g) => g.name),
        runtime: details.runtime,
      });
    }

    // 3. Format backdrops
    const backdrops = (details.images?.backdrops || [])
      .map((b) => b.file_path)
      .filter(Boolean);

    // ✅ Return title and backdrops
    res.json({
      title: details.title,
      backdrops,
    });
  } catch (err) {
    console.error('🎬 Movie details fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch movie details.' });
  }
});

module.exports = router;
