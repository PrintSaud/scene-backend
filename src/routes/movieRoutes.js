const express = require('express');
const router = express.Router();

const {
  searchMovies,
  getMovieDetails,
  getTrendingMovies,
} = require('../services/tmdbService');

const Movie = require('../models/movieModel');

// ✅ PATCH /api/movies/:tmdbId/poster → must be FIRST
router.patch('/:tmdbId/poster', async (req, res) => {
  console.log("✅ PATCH /api/movies/:tmdbId/poster HIT");

  try {
    const { posterUrl } = req.body;
    const tmdbId = parseInt(req.params.tmdbId);

    if (!posterUrl || isNaN(tmdbId)) {
      return res.status(400).json({ error: 'Missing poster or invalid ID.' });
    }

    let movie = await Movie.findOneAndUpdate(
      { tmdbId },
      { poster: posterUrl },
      { new: true }
    );

    // If not found, create new doc
    if (!movie) {
      movie = await Movie.create({
        tmdbId,
        poster: posterUrl,
        title: "Untitled",
      });
    }

    res.json({ message: 'Poster updated successfully ✅', poster: movie.poster });
  } catch (err) {
    console.error('🛠️ Failed to update poster:', err);
    res.status(500).json({ error: 'Failed to update poster.' });
  }
});

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

    const details = await getMovieDetails(tmdbId);

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

    const backdrops = (details.images?.backdrops || [])
      .map((b) => b.file_path)
      .filter(Boolean);

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
