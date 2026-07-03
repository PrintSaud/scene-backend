// src/routes/movieRoutes.js

const express = require("express");

const router = express.Router();

const {
  searchMovies,
  getMovieDetails,
  getTrendingMovies,
} = require("../services/tmdbService");

const Movie = require("../models/movieModel");
const protect = require("../middleware/authMiddleware");

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

const protect = require("../middleware/authMiddleware");

function isMovieAdmin(req) {
  return (
    process.env.ADMIN_USER_ID &&
    String(req.user?._id) === String(process.env.ADMIN_USER_ID)
  );
}

function parsePositiveInteger(value) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function isValidHttpUrl(value) {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value.trim());

    return (
      url.protocol === "https:" ||
      url.protocol === "http:"
    );
  } catch {
    return false;
  }
}

function isMovieAdmin(req) {
  const configuredAdminId =
    process.env.ADMIN_USER_ID;

  if (!configuredAdminId) {
    return false;
  }

  return (
    String(req.user?._id) ===
    String(configuredAdminId)
  );
}

router.patch('/:tmdbId/poster', protect, async (req, res) => {
  if (!isMovieAdmin(req)) {
    return res.status(403).json({
      error: "Not authorized",
    });
  }

  console.log("✅ PATCH /api/movies/:tmdbId/poster HIT");

  try {
    const { posterUrl } = req.body;
    const tmdbId = parseInt(req.params.tmdbId);

    if (!posterUrl || isNaN(tmdbId)) {
      return res.status(400).json({
        error: "Missing poster or invalid ID.",
      });
    }

    let movie = await Movie.findOneAndUpdate(
      { tmdbId },
      { poster: posterUrl },
      { new: true }
    );

    if (!movie) {
      movie = await Movie.create({
        tmdbId,
        poster: posterUrl,
        title: "Untitled",
      });
    }

    return res.json({
      message: "Poster updated successfully ✅",
      poster: movie.poster,
    });
  } catch (err) {
    console.error(
      "🛠️ Failed to update poster:",
      err
    );

    return res.status(500).json({
      error: "Failed to update poster.",
    });
  }
});

// GET /api/movies/trending
router.get("/trending", async (req, res) => {
  try {
    const movies =
      await getTrendingMovies("en-US");

    const formatted = (
      Array.isArray(movies)
        ? movies
        : []
    )
      .slice(0, 20)
      .map((movie) => ({
        id: movie.id,
        title_en: movie.title || "",
        poster: movie.poster_path
          ? `${TMDB_IMAGE_BASE}/w500${movie.poster_path}`
          : null,
      }));

    return res.status(200).json(
      formatted
    );
  } catch (error) {
    console.error(
      "❌ Trending movie fetch failed:",
      error
    );

    return res.status(500).json({
      error:
        "Failed to fetch trending movies",
    });
  }
});


// GET /api/movies/search?q=...
router.get("/search", async (req, res) => {
  try {
    const query =
      typeof req.query.q === "string"
        ? req.query.q.trim().slice(0, 150)
        : "";

    if (!query) {
      return res.status(400).json({
        error:
          "Query parameter `q` is required",
      });
    }

    const requestedPage =
      Number(req.query.page);

    const page =
      Number.isInteger(requestedPage) &&
      requestedPage > 0
        ? Math.min(requestedPage, 500)
        : 1;

    const data = await searchMovies(
      query,
      page,
      "en-US"
    );

    const results = Array.isArray(
      data?.results
    )
      ? data.results
      : [];

    return res.status(200).json({
      results: results.map((movie) => ({
        id: movie.id,
        title_en: movie.title || "",
        poster: movie.poster_path
          ? `${TMDB_IMAGE_BASE}/w500${movie.poster_path}`
          : null,
        backdrop: movie.backdrop_path
          ? `${TMDB_IMAGE_BASE}/w780${movie.backdrop_path}`
          : null,
        original_language:
          movie.original_language || "",
        overview: movie.overview || "",
        vote_average:
          Number(movie.vote_average) || 0,
        vote_count:
          Number(movie.vote_count) || 0,
        popularity:
          Number(movie.popularity) || 0,
        adult: movie.adult === true,
      })),

      page:
        Number(data?.page) || page,

      totalPages:
        Number(data?.total_pages) || 0,

      totalResults:
        Number(data?.total_results) || 0,
    });
  } catch (error) {
    console.error(
      "❌ Movie search failed:",
      error
    );

    return res.status(500).json({
      error:
        "Failed to search movies",
    });
  }
});


// GET /api/movies/:tmdbId
// Return English and Arabic movie information.
router.get("/:tmdbId", async (req, res) => {
  try {
    const tmdbId =
      parsePositiveInteger(
        req.params.tmdbId
      );

    if (!tmdbId) {
      return res.status(400).json({
        error: "Invalid movie ID",
      });
    }

    const [
      detailsEnResult,
      detailsArResult,
    ] = await Promise.allSettled([
      getMovieDetails(
        tmdbId,
        "en-US"
      ),

      getMovieDetails(
        tmdbId,
        "ar-SA"
      ),
    ]);

    if (
      detailsEnResult.status !==
        "fulfilled" ||
      !detailsEnResult.value
    ) {
      return res.status(404).json({
        error: "Movie not found",
      });
    }

    const detailsEn =
      detailsEnResult.value;

    const detailsAr =
      detailsArResult.status ===
      "fulfilled"
        ? detailsArResult.value
        : null;

    const genres = Array.isArray(
      detailsEn.genres
    )
      ? detailsEn.genres
          .map((genre) => genre?.name)
          .filter(Boolean)
      : [];

    /*
     * Cache basic movie information locally.
     * Existing data is refreshed rather than only being created once.
     */
    await Movie.findOneAndUpdate(
      {
        tmdbId,
      },
      {
        $set: {
          title:
            detailsEn.title || "",
          overview:
            detailsEn.overview || "",
          posterPath:
            detailsEn.poster_path ||
            null,
          releaseDate:
            detailsEn.release_date ||
            null,
          genres,
          runtime:
            Number(detailsEn.runtime) ||
            null,
        },
      },
      {
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      }
    );

    const backdrops = Array.isArray(
      detailsEn.images?.backdrops
    )
      ? detailsEn.images.backdrops
          .map((backdrop) =>
            backdrop?.file_path
              ? `${TMDB_IMAGE_BASE}/original${backdrop.file_path}`
              : null
          )
          .filter(Boolean)
      : [];

    return res.status(200).json({
      id: detailsEn.id,
      title_en:
        detailsEn.title || "",
      title_ar:
        detailsAr?.title ||
        detailsEn.title ||
        "",
      original_language:
        detailsEn.original_language ||
        "",
      poster_path:
        detailsEn.poster_path ||
        null,
      release_date:
        detailsEn.release_date ||
        "",
      overview_en:
        detailsEn.overview || "",
      overview_ar:
        detailsAr?.overview || "",
      runtime:
        Number(detailsEn.runtime) ||
        null,
      genres:
        detailsEn.genres || [],
      backdrops,
    });
  } catch (error) {
    console.error(
      "❌ Movie details fetch failed:",
      error
    );

    return res.status(500).json({
      error:
        "Failed to fetch movie details",
    });
  }
});


module.exports = router;