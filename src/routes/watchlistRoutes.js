const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const User = require("../models/user");
const protect = require("../middleware/authMiddleware");
const {
  getMovieDetails,
} = require("../services/tmdbService");
const CustomPoster = require("../models/customPoster");

const MAX_HYDRATIONS_PER_REQUEST = 30;

// ============================================================
// HELPERS
// ============================================================

const isValidObjectId = (value) =>
  mongoose.Types.ObjectId.isValid(value);

const parseMovieId = (value) => {
  const movieId = Number(value);

  if (
    !Number.isInteger(movieId) ||
    movieId <= 0
  ) {
    return null;
  }

  return movieId;
};

const normalizeWatchlist = (watchlist) => {
  if (!Array.isArray(watchlist)) {
    return [];
  }

  const seen = new Set();
  const cleaned = [];

  for (const rawItem of watchlist) {
    if (
      !rawItem ||
      typeof rawItem !== "object"
    ) {
      continue;
    }

    const item =
      typeof rawItem.toObject === "function"
        ? rawItem.toObject()
        : rawItem;

    const tmdbId = parseMovieId(
      item.tmdbId
    );

    if (!tmdbId || seen.has(tmdbId)) {
      continue;
    }

    seen.add(tmdbId);

    cleaned.push({
      ...item,
      tmdbId,
    });
  }

  return cleaned;
};

const getGenreId = (genre) => {
  if (
    genre &&
    typeof genre === "object"
  ) {
    return Number(genre.id);
  }

  return Number(genre);
};

const toTimestamp = (value) => {
  if (!value) return 0;

  const timestamp =
    new Date(value).getTime();

  return Number.isFinite(timestamp)
    ? timestamp
    : 0;
};

const cleanMovieDetails = (
  movieId,
  details
) => ({
  tmdbId: movieId,

  poster_path:
    details?.poster_path || null,

  title:
    details?.title ||
    details?.name ||
    null,

  release_date:
    details?.release_date || null,

  runtime:
    Number.isFinite(
      Number(details?.runtime)
    )
      ? Number(details.runtime)
      : null,

  vote_average:
    Number.isFinite(
      Number(details?.vote_average)
    )
      ? Number(details.vote_average)
      : null,

  genres:
    Array.isArray(details?.genres)
      ? details.genres
      : [],

  addedAt: new Date(),
});

const needsHydration = (movie) =>
  !movie.title ||
  !movie.poster_path ||
  !movie.release_date ||
  movie.runtime === undefined ||
  movie.runtime === null ||
  movie.vote_average === undefined ||
  movie.vote_average === null ||
  !Array.isArray(movie.genres) ||
  movie.genres.length === 0;

async function getCustomPosterMap(
  userId,
  movieIds
) {
  if (
    !isValidObjectId(userId) ||
    !movieIds.length
  ) {
    return new Map();
  }

  const customPosters =
    await CustomPoster.find({
      userId,

      movieId: {
        $in: movieIds,
      },
    })
      .select("movieId posterUrl")
      .lean();

  return new Map(
    customPosters.map((poster) => [
      Number(poster.movieId),
      poster.posterUrl,
    ])
  );
}

// ============================================================
// STATUS
// ============================================================

// GET /api/watchlist/status/:movieId
router.get(
  "/status/:movieId",
  protect,
  async (req, res) => {
    try {
      const movieId = parseMovieId(
        req.params.movieId
      );

      if (!movieId) {
        return res.status(400).json({
          error: "Invalid movie ID",
        });
      }

      const user = await User.findById(
        req.user._id
      )
        .select("watchlist")
        .lean();

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      const inWatchlist =
        normalizeWatchlist(
          user.watchlist
        ).some(
          (item) =>
            Number(item.tmdbId) ===
            movieId
        );

      return res.json({
        inWatchlist,
      });
    } catch (error) {
      console.error(
        "❌ Watchlist status failed:",
        error
      );

      return res.status(500).json({
        error:
          "Failed to check watchlist",
      });
    }
  }
);

// ============================================================
// TOGGLE
// ============================================================

// POST /api/watchlist/toggle
router.post(
  "/toggle",
  protect,
  async (req, res) => {
    try {
      const movieId = parseMovieId(
        req.body.movieId
      );

      if (!movieId) {
        return res.status(400).json({
          error: "Invalid movie ID",
        });
      }

      const user = await User.findById(
        req.user._id
      );

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      const cleanedWatchlist =
        normalizeWatchlist(
          user.watchlist
        );

      const existingIndex =
        cleanedWatchlist.findIndex(
          (item) =>
            Number(item.tmdbId) ===
            movieId
        );

      if (existingIndex !== -1) {
        cleanedWatchlist.splice(
          existingIndex,
          1
        );

        user.watchlist =
          cleanedWatchlist;

        await user.save();

        return res.json({
          message:
            "Removed from watchlist",

          inWatchlist: false,

          watchlistCount:
            cleanedWatchlist.length,
        });
      }

      let details;

      try {
        details =
          await getMovieDetails(
            movieId
          );
      } catch (tmdbError) {
        console.error(
          `❌ Failed to fetch movie ${movieId}:`,
          tmdbError.message
        );

        return res.status(502).json({
          error:
            "Failed to fetch movie details",
        });
      }

      if (!details) {
        return res.status(404).json({
          error: "Movie not found",
        });
      }

      cleanedWatchlist.push(
        cleanMovieDetails(
          movieId,
          details
        )
      );

      user.watchlist =
        cleanedWatchlist;

      await user.save();

      return res.json({
        message: "Added to watchlist",

        inWatchlist: true,

        watchlistCount:
          cleanedWatchlist.length,
      });
    } catch (error) {
      console.error(
        "❌ Toggle watchlist failed:",
        error
      );

      return res.status(500).json({
        error:
          "Failed to toggle watchlist",
      });
    }
  }
);

// ============================================================
// OWNER-COMPATIBILITY MUTATION ROUTES
// ============================================================

/*
 * These paths remain for frontend compatibility.
 * They now require authentication and ownership.
 */

// POST /api/watchlist/:userId/watchlist
router.post(
  "/:userId/watchlist",
  protect,
  async (req, res) => {
    try {
      const { userId } = req.params;

      if (!isValidObjectId(userId)) {
        return res.status(400).json({
          error: "Invalid user ID",
        });
      }

      if (
        String(userId) !==
        String(req.user._id)
      ) {
        return res.status(403).json({
          error:
            "You can only update your own watchlist",
        });
      }

      const movieId = parseMovieId(
        req.body.tmdbId
      );

      if (!movieId) {
        return res.status(400).json({
          error: "Invalid tmdbId",
        });
      }

      const user = await User.findById(
        userId
      );

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      const watchlist =
        normalizeWatchlist(
          user.watchlist
        );

      const alreadyExists =
        watchlist.some(
          (item) =>
            Number(item.tmdbId) ===
            movieId
        );

      if (alreadyExists) {
        return res.json({
          added: false,
          inWatchlist: true,
          watchlistCount:
            watchlist.length,
        });
      }

      let details;

      try {
        details =
          await getMovieDetails(
            movieId
          );
      } catch (tmdbError) {
        console.error(
          `❌ Failed to fetch movie ${movieId}:`,
          tmdbError.message
        );

        return res.status(502).json({
          error:
            "Failed to fetch movie details",
        });
      }

      if (!details) {
        return res.status(404).json({
          error: "Movie not found",
        });
      }

      watchlist.push(
        cleanMovieDetails(
          movieId,
          details
        )
      );

      user.watchlist = watchlist;

      await user.save();

      return res.status(201).json({
        added: true,
        inWatchlist: true,
        watchlistCount:
          watchlist.length,
      });
    } catch (error) {
      console.error(
        "❌ Manual watchlist add failed:",
        error
      );

      return res.status(500).json({
        error:
          "Could not add to watchlist",
      });
    }
  }
);

// DELETE /api/watchlist/:userId/watchlist/:tmdbId
router.delete(
  "/:userId/watchlist/:tmdbId",
  protect,
  async (req, res) => {
    try {
      const {
        userId,
        tmdbId: rawMovieId,
      } = req.params;

      if (!isValidObjectId(userId)) {
        return res.status(400).json({
          error: "Invalid user ID",
        });
      }

      if (
        String(userId) !==
        String(req.user._id)
      ) {
        return res.status(403).json({
          error:
            "You can only update your own watchlist",
        });
      }

      const movieId = parseMovieId(
        rawMovieId
      );

      if (!movieId) {
        return res.status(400).json({
          error: "Invalid movie ID",
        });
      }

      const user = await User.findById(
        userId
      );

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      const watchlist =
        normalizeWatchlist(
          user.watchlist
        );

      const filteredWatchlist =
        watchlist.filter(
          (item) =>
            Number(item.tmdbId) !==
            movieId
        );

      const removed =
        filteredWatchlist.length !==
        watchlist.length;

      user.watchlist =
        filteredWatchlist;

      await user.save();

      return res.json({
        removed,
        inWatchlist: false,
        watchlistCount:
          filteredWatchlist.length,
      });
    } catch (error) {
      console.error(
        "❌ Manual watchlist removal failed:",
        error
      );

      return res.status(500).json({
        error:
          "Could not remove from watchlist",
      });
    }
  }
);

// ============================================================
// PUBLIC WATCHLIST RETRIEVAL
// ============================================================

// GET /api/watchlist/:userId/watchlist
router.get(
  "/:userId/watchlist",
  async (req, res) => {
    try {
      const { userId } = req.params;

      if (!isValidObjectId(userId)) {
        return res.status(400).json({
          error: "Invalid user ID",
        });
      }

      const rawSort =
        typeof req.query.sort ===
        "string"
          ? req.query.sort
          : "added";

      const allowedSorts = new Set([
        "added",
        "release",
        "rating",
        "runtime",
        "title",
      ]);

      const sort =
        allowedSorts.has(rawSort)
          ? rawSort
          : "added";

      const direction =
        req.query.order === "asc"
          ? 1
          : -1;

      const genreId =
        req.query.genre !== undefined
          ? Number(req.query.genre)
          : null;

      if (
        req.query.genre !== undefined &&
        (
          !Number.isInteger(genreId) ||
          genreId <= 0
        )
      ) {
        return res.status(400).json({
          error: "Invalid genre ID",
        });
      }

      const user = await User.findById(
        userId
      )
        .select("watchlist")
        .lean();

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      let movies = normalizeWatchlist(
        user.watchlist
      );

      /*
       * This does not limit the watchlist.
       *
       * It only limits how many missing movie
       * records may trigger a TMDB request during
       * one request.
       */
      const moviesNeedingHydration =
        movies
          .filter(needsHydration)
          .slice(
            0,
            MAX_HYDRATIONS_PER_REQUEST
          );

      if (
        moviesNeedingHydration.length
      ) {
        const hydrationResults =
          await Promise.allSettled(
            moviesNeedingHydration.map(
              async (movie) => {
                const details =
                  await getMovieDetails(
                    movie.tmdbId
                  );

                return {
                  movieId:
                    movie.tmdbId,

                  details,
                };
              }
            )
          );

        const hydratedMap = new Map();

        for (
          const result of hydrationResults
        ) {
          if (
            result.status !==
              "fulfilled" ||
            !result.value.details
          ) {
            continue;
          }

          hydratedMap.set(
            result.value.movieId,
            result.value.details
          );
        }

        movies = movies.map((movie) => {
          const details =
            hydratedMap.get(
              movie.tmdbId
            );

          if (!details) {
            return movie;
          }

          return {
            ...movie,

            title:
              movie.title ||
              details.title ||
              details.name ||
              null,

            poster_path:
              movie.poster_path ||
              details.poster_path ||
              null,

            release_date:
              movie.release_date ||
              details.release_date ||
              null,

            runtime:
              movie.runtime ??
              details.runtime ??
              null,

            vote_average:
              movie.vote_average ??
              details.vote_average ??
              null,

            genres:
              Array.isArray(
                movie.genres
              ) &&
              movie.genres.length
                ? movie.genres
                : (
                    Array.isArray(
                      details.genres
                    )
                      ? details.genres
                      : []
                  ),
          };
        });

        /*
         * Persist all successfully hydrated data
         * with one database update.
         */
        if (hydratedMap.size) {
          await User.updateOne(
            {
              _id: userId,
            },
            {
              $set: {
                watchlist: movies,
              },
            }
          );
        }
      }

      if (genreId) {
        movies = movies.filter(
          (movie) =>
            Array.isArray(
              movie.genres
            ) &&
            movie.genres.some(
              (genre) =>
                getGenreId(genre) ===
                genreId
            )
        );
      }

      movies.sort((first, second) => {
        if (sort === "added") {
          return (
            (
              toTimestamp(first.addedAt) -
              toTimestamp(second.addedAt)
            ) * direction
          );
        }

        if (sort === "release") {
          return (
            (
              toTimestamp(
                first.release_date
              ) -
              toTimestamp(
                second.release_date
              )
            ) * direction
          );
        }

        if (sort === "rating") {
          const firstRating =
            Number.isFinite(
              Number(
                first.vote_average
              )
            )
              ? Number(
                  first.vote_average
                )
              : 0;

          const secondRating =
            Number.isFinite(
              Number(
                second.vote_average
              )
            )
              ? Number(
                  second.vote_average
                )
              : 0;

          return (
            (
              firstRating -
              secondRating
            ) * direction
          );
        }

        if (sort === "runtime") {
          const firstRuntime =
            Number.isFinite(
              Number(first.runtime)
            )
              ? Number(first.runtime)
              : 0;

          const secondRuntime =
            Number.isFinite(
              Number(second.runtime)
            )
              ? Number(second.runtime)
              : 0;

          return (
            (
              firstRuntime -
              secondRuntime
            ) * direction
          );
        }

        return (
          String(
            first.title || ""
          ).localeCompare(
            String(
              second.title || ""
            )
          ) * direction
        );
      });

      /*
       * Return every watchlist entry.
       * There is no pagination or item cap.
       */
      const movieIds = movies.map(
        (movie) =>
          Number(movie.tmdbId)
      );

      const customPosterMap =
        await getCustomPosterMap(
          userId,
          movieIds
        );

      const enriched = movies.map(
        (movie) => ({
          ...movie,

          posterOverride:
            customPosterMap.get(
              Number(movie.tmdbId)
            ) || null,
        })
      );

      res.setHeader(
        "X-Total-Count",
        String(enriched.length)
      );

      return res.json(enriched);
    } catch (error) {
      console.error(
        "❌ Failed to fetch watchlist:",
        error
      );

      return res.status(500).json({
        error:
          "Could not fetch watchlist",
      });
    }
  }
);

module.exports = router;