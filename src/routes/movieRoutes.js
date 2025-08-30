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
    const movies = await getTrendingMovies("en-US");
    const formatted = movies.slice(0, 20).map((movie) => ({
      id: movie.id,
      title_en: movie.title, // English title
      poster: movie.poster_path
        ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
        : null,
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

    const data = await searchMovies(q, page, "en-US"); // force English

    res.json({
      results: data.results.map((m) => ({
        id: m.id,
        title_en: m.title,
        poster: m.poster_path
          ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
          : null,
        backdrop: m.backdrop_path
          ? `https://image.tmdb.org/t/p/w780${m.backdrop_path}`
          : null,
        original_language: m.original_language,
        overview: m.overview || "",
        vote_average: m.vote_average || 0,
        vote_count: m.vote_count || 0,
        popularity: m.popularity || 0,
        adult: m.adult || false,
      })),
      totalPages: data.total_pages,
    });
  } catch (err) {
    console.error('🔍 Search error:', err);
    res.status(500).json({ error: 'Failed to search movies.' });
  }
});

// 🎬 GET /api/movies/:tmdbId → returns English + Arabic titles + backdrops
router.get('/:tmdbId', async (req, res) => {
  try {
    const tmdbId = parseInt(req.params.tmdbId);
    if (!tmdbId || isNaN(tmdbId)) {
      return res.status(400).json({ error: '❌ Invalid Movie ID' });
    }

    // Fetch both English + Arabic versions with backdrops
    const detailsEn = await getMovieDetails(tmdbId, "en-US");
    const detailsAr = await getMovieDetails(tmdbId, "ar-SA");

    if (!detailsEn) {
      return res.status(404).json({ error: "Movie not found" });
    }

    // Save to DB if missing
    let movie = await Movie.findOne({ tmdbId });
    if (!movie) {
      movie = await Movie.create({
        tmdbId: detailsEn.id,
        title: detailsEn.title,
        overview: detailsEn.overview,
        posterPath: detailsEn.poster_path,
        releaseDate: detailsEn.release_date,
        genres: detailsEn.genres.map((g) => g.name),
        runtime: detailsEn.runtime,
      });
    }

    // ✅ Full URLs for backdrops
    const backdrops = (detailsEn.images?.backdrops || [])
      .map((b) => `https://image.tmdb.org/t/p/original${b.file_path}`)
      .filter(Boolean);

    res.json({
      title_en: detailsEn.title,
      title_ar: detailsAr?.title || detailsEn.title,
      original_language: detailsEn.original_language,
      backdrops,
    });
  } catch (err) {
    console.error('🎬 Movie details fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch movie details.' });
  }
});

module.exports = router;
