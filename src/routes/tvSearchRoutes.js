// src/routes/tvSearchRoutes.js

const express = require("express");

const router = express.Router();

const Show = require("../models/showModel");

const {
  searchTVShows,
  formatShowSearchResult,
  syncShowFromTMDB,
} = require("../services/tvMetadataService");

const TMDB_IMAGE_BASE =
  "https://image.tmdb.org/t/p";

// ======================================================
// Helpers
// ======================================================

function imageUrl(path, size = "original") {
  if (
    typeof path !== "string" ||
    !path.trim()
  ) {
    return null;
  }

  const cleanPath = path.trim();

  if (
    cleanPath.startsWith("http://") ||
    cleanPath.startsWith("https://")
  ) {
    return cleanPath;
  }

  return `${TMDB_IMAGE_BASE}/${size}${cleanPath}`;
}

function normalizeString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function normalizeArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}

function parsePage(value) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 1
  ) {
    return 1;
  }

  return Math.min(parsed, 500);
}

function parseLimit(value) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 1
  ) {
    return 20;
  }

  return Math.min(parsed, 40);
}

function getYear(dateValue) {
  if (!dateValue) {
    return null;
  }

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.getUTCFullYear();
}

function formatSearchResult(
  show,
  localShow = null
) {
  const base =
    formatShowSearchResult(show);

  return {
    ...base,

    tmdbId:
      Number(show?.id) || null,

    localId:
      localShow?._id || null,

    nameAr:
      normalizeString(
        localShow?.nameAr
      ),

    poster:
      imageUrl(
        show?.poster_path,
        "w500"
      ),

    backdrop:
      imageUrl(
        show?.backdrop_path,
        "w780"
      ),

    year:
      getYear(
        show?.first_air_date
      ),

    genres:
      normalizeArray(
        localShow?.genres
      ),

    isCached:
      Boolean(localShow),

    airedEpisodeCount:
      Number(
        localShow?.airedEpisodeCount
      ) || 0,

    airedSeasonCount:
      Number(
        localShow?.airedSeasonCount
      ) || 0,

    viewer: {
      progressPercentage: 0,
      watchedEpisodeCount: 0,
      isInWatchlist: false,
      isFavorite: false,
      customPoster: null,
    },
  };
}

// ======================================================
// GET /api/tv-search?q=breaking+bad
//
// Search only TV shows.
// ======================================================

router.get("/", async (req, res) => {
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

    const page = parsePage(
      req.query.page
    );

    const limit = parseLimit(
      req.query.limit
    );

    const language =
      req.query.language === "ar-SA"
        ? "ar-SA"
        : "en-US";

    const data = await searchTVShows(
      query,
      page,
      language
    );

    const rawResults =
      normalizeArray(
        data?.results
      ).slice(0, limit);

    const tmdbIds = rawResults
      .map((show) => Number(show?.id))
      .filter(
        (id) =>
          Number.isInteger(id) &&
          id > 0
      );

    const localShows =
      tmdbIds.length > 0
        ? await Show.find({
            tmdbId: {
              $in: tmdbIds,
            },
          }).lean()
        : [];

    const localShowMap = new Map(
      localShows.map((show) => [
        Number(show.tmdbId),
        show,
      ])
    );

    const results = rawResults.map(
      (show) =>
        formatSearchResult(
          show,
          localShowMap.get(
            Number(show.id)
          ) || null
        )
    );

    return res.status(200).json({
      query,
      language,

      results,

      page:
        Number(data?.page) || page,

      totalPages:
        Number(
          data?.total_pages
        ) || 0,

      totalResults:
        Number(
          data?.total_results
        ) || 0,

      hasNextPage:
        Number(data?.page) <
        Number(data?.total_pages),
    });
  } catch (error) {
    console.error(
      "❌ TV search failed:",
      error
    );

    return res.status(500).json({
      error:
        "Failed to search TV shows",
    });
  }
});

// ======================================================
// GET /api/tv-search/suggestions?q=break
//
// Lightweight search suggestions.
// ======================================================

router.get(
  "/suggestions",
  async (req, res) => {
    try {
      const query =
        typeof req.query.q === "string"
          ? req.query.q
              .trim()
              .slice(0, 80)
          : "";

      if (query.length < 2) {
        return res.status(200).json({
          query,
          suggestions: [],
        });
      }

      const language =
        req.query.language === "ar-SA"
          ? "ar-SA"
          : "en-US";

      const data =
        await searchTVShows(
          query,
          1,
          language
        );

      const suggestions =
        normalizeArray(
          data?.results
        )
          .slice(0, 8)
          .map((show) => ({
            tmdbId:
              Number(show?.id) ||
              null,

            name:
              normalizeString(
                show?.name
              ),

            originalName:
              normalizeString(
                show?.original_name
              ),

            year:
              getYear(
                show?.first_air_date
              ),

            posterPath:
              show?.poster_path ||
              null,

            poster:
              imageUrl(
                show?.poster_path,
                "w342"
              ),
          }));

      return res.status(200).json({
        query,
        suggestions,
      });
    } catch (error) {
      console.error(
        "❌ TV search suggestions failed:",
        error
      );

      return res.status(500).json({
        error:
          "Failed to fetch TV suggestions",
      });
    }
  }
);

// ======================================================
// POST /api/tv-search/:showTmdbId/cache
//
// Optional helper used after a user opens or selects a show.
// Hydrates the local Show document.
// ======================================================

router.post(
  "/:showTmdbId/cache",
  async (req, res) => {
    try {
      const showTmdbId = Number(
        req.params.showTmdbId
      );

      if (
        !Number.isInteger(showTmdbId) ||
        showTmdbId < 1
      ) {
        return res.status(400).json({
          error: "Invalid show ID",
        });
      }

      const show =
        await syncShowFromTMDB(
          showTmdbId
        );

      if (!show) {
        return res.status(404).json({
          error: "Show not found",
        });
      }

      return res.status(200).json({
        message:
          "Show cached successfully",

        show: {
          localId:
            show._id,

          tmdbId:
            show.tmdbId,

          name:
            show.name,

          nameAr:
            show.nameAr || "",

          posterPath:
            show.posterPath ||
            null,

          backdropPath:
            show.backdropPath ||
            null,

          firstAirDate:
            show.firstAirDate ||
            null,
        },
      });
    } catch (error) {
      console.error(
        "❌ TV show cache failed:",
        error
      );

      return res.status(500).json({
        error:
          "Failed to cache show",
      });
    }
  }
);

// ======================================================
// Export
// ======================================================

module.exports = router;