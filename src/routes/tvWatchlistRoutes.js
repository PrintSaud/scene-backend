// src/routes/tvWatchlistRoutes.js

const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const protect = require(
  "../middleware/authMiddleware"
);

const User = require(
  "../models/user"
);

const Show = require(
  "../models/showModel"
);

const UserShowProgress = require(
  "../models/userShowProgress"
);

// ======================================================
// Constants
// ======================================================

const DEFAULT_LIMIT = 30;
const MAXIMUM_LIMIT = 100;

// ======================================================
// Helpers
// ======================================================

function getAuthenticatedUserId(req) {
  return (
    req.user?._id ||
    req.user?.id ||
    null
  );
}

function parsePositiveInteger(
  value,
  fieldName = "ID"
) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 1
  ) {
    const error = new Error(
      `Invalid ${fieldName}`
    );

    error.statusCode = 400;

    throw error;
  }

  return parsed;
}

function parseLimit(
  value,
  fallback = DEFAULT_LIMIT
) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 1
  ) {
    return fallback;
  }

  return Math.min(
    parsed,
    MAXIMUM_LIMIT
  );
}

function parsePage(value) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 1
  ) {
    return 1;
  }

  return parsed;
}

function normalizeString(
  value,
  maximumLength = 2000
) {
  if (
    typeof value !== "string"
  ) {
    return "";
  }

  return value
    .trim()
    .slice(0, maximumLength);
}

function normalizeVoteAverage(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed = Number(value);

  if (
    !Number.isFinite(parsed)
  ) {
    return null;
  }

  return Math.max(
    0,
    Math.min(10, parsed)
  );
}

function normalizeGenres(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();

  return value
    .map((genre) => {
      if (
        !genre ||
        typeof genre !== "object"
      ) {
        return null;
      }

      const id =
        Number.isFinite(
          Number(genre.id)
        )
          ? Number(genre.id)
          : null;

      const name =
        normalizeString(
          genre.name,
          200
        );

      const key =
        id !== null
          ? `id:${id}`
          : `name:${name.toLowerCase()}`;

      if (
        (!name && id === null) ||
        seen.has(key)
      ) {
        return null;
      }

      seen.add(key);

      return {
        id,
        name,
      };
    })
    .filter(Boolean)
    .slice(0, 30);
}

function escapeRegex(value) {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function serializeWatchlistItem(
  item
) {
  return {
    id: item._id
      ? String(item._id)
      : null,

    tmdbId:
      Number(item.tmdbId),

    name:
      item.name || "",

    nameAr:
      item.nameAr || "",

    originalName:
      item.originalName || "",

    posterPath:
      item.posterPath || "",

    backdropPath:
      item.backdropPath || "",

    firstAirDate:
      item.firstAirDate || "",

    status:
      item.status || "",

    voteAverage:
      item.voteAverage ??
      null,

    genres:
      Array.isArray(
        item.genres
      )
        ? item.genres
        : [],

    addedAt:
      item.addedAt || null,
  };
}

function serializeUpcomingEpisode(
  progress
) {
  const episode =
    progress.nextUnwatchedEpisode;

  if (!episode) {
    return null;
  }

  return {
    progressId:
      String(progress._id),

    show: {
      id: progress.show
        ? String(progress.show)
        : null,

      tmdbId:
        progress.showTmdbId,

      name:
        progress.showName || "",

      nameAr:
        progress.showNameAr || "",

      posterPath:
        progress.posterPath || "",

      backdropPath:
        progress.backdropPath || "",

      firstAirDate:
        progress.firstAirDate ||
        null,
    },

    episode: {
      tmdbId:
        episode.episodeTmdbId ||
        null,

      seasonNumber:
        episode.seasonNumber,

      episodeNumber:
        episode.episodeNumber,

      code:
        `S${episode.seasonNumber}E${episode.episodeNumber}`,

      name:
        episode.name || "",

      stillPath:
        episode.stillPath || "",

      airDate:
        episode.airDate || null,

      runtime:
        episode.runtime ?? null,

      aired:
        episode.airDate
          ? new Date(
              episode.airDate
            ).getTime() <=
            Date.now()
          : false,
    },

    progress: {
      status:
        progress.status ||
        "watching",

      percentage:
        progress.progressPercentage ||
        0,

      watchedEpisodeCount:
        progress.watchedEpisodeCount ||
        0,

      airedEpisodeCount:
        progress.airedEpisodeCount ||
        0,

      totalEpisodeCount:
        progress.totalEpisodeCount ||
        0,

      totalWatchCount:
        progress.totalWatchCount ||
        0,

      rewatchCount:
        progress.rewatchCount ||
        0,

      lastWatchedAt:
        progress.lastWatchedAt ||
        null,
    },

    navigation: {
      screen: "Episode",

      params: {
        showTmdbId:
          progress.showTmdbId,

        seasonNumber:
          episode.seasonNumber,

        episodeNumber:
          episode.episodeNumber,

        episodeTmdbId:
          episode.episodeTmdbId ||
          null,
      },
    },
  };
}

function buildWatchlistSnapshot({
  tmdbId,
  localShow,
  input,
}) {
  return {
    tmdbId,

    name:
      normalizeString(
        input.name,
        500
      ) ||
      normalizeString(
        localShow?.name,
        500
      ),

    nameAr:
      normalizeString(
        input.nameAr,
        500
      ) ||
      normalizeString(
        localShow?.nameAr,
        500
      ),

    originalName:
      normalizeString(
        input.originalName,
        500
      ) ||
      normalizeString(
        localShow?.originalName,
        500
      ),

    posterPath:
      normalizeString(
        input.posterPath,
        2000
      ) ||
      normalizeString(
        localShow?.posterPath,
        2000
      ),

    backdropPath:
      normalizeString(
        input.backdropPath,
        2000
      ) ||
      normalizeString(
        localShow?.backdropPath,
        2000
      ),

    firstAirDate:
      normalizeString(
        input.firstAirDate,
        100
      ) ||
      (
        localShow?.firstAirDate
          ? new Date(
              localShow.firstAirDate
            )
              .toISOString()
              .slice(0, 10)
          : ""
      ),

    status:
      normalizeString(
        input.status,
        200
      ) ||
      normalizeString(
        localShow?.status,
        200
      ),

    voteAverage:
      normalizeVoteAverage(
        input.voteAverage ??
        localShow?.voteAverage
      ),

    genres:
      normalizeGenres(
        input.genres?.length
          ? input.genres
          : localShow?.genres
      ),

    addedAt:
      new Date(),
  };
}

function handleError(
  error,
  res,
  fallbackMessage
) {
  console.error(
    `❌ ${fallbackMessage}:`,
    error?.stack || error
  );

  const statusCode =
    Number(error?.statusCode) ||
    500;

  return res
    .status(statusCode)
    .json({
      error:
        statusCode < 500
          ? error.message
          : fallbackMessage,

      details:
        process.env.NODE_ENV ===
        "production"
          ? undefined
          : error?.message ||
            undefined,
    });
}

// ======================================================
// GET /api/tv-watchlist
//
// Signed-in user's TV watchlist.
// ======================================================

router.get(
  "/",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const page =
        parsePage(
          req.query.page
        );

      const limit =
        parseLimit(
          req.query.limit
        );

      const user =
        await User.findById(
          userId
        )
          .select(
            "tvWatchlist"
          )
          .lean();

      if (!user) {
        return res.status(404).json({
          error:
            "User not found",
        });
      }

      const watchlist =
        Array.isArray(
          user.tvWatchlist
        )
          ? [...user.tvWatchlist]
          : [];

      watchlist.sort(
        (first, second) =>
          new Date(
            second.addedAt || 0
          ).getTime() -
          new Date(
            first.addedAt || 0
          ).getTime()
      );

      const start =
        (page - 1) *
        limit;

      const visibleItems =
        watchlist.slice(
          start,
          start + limit
        );

      return res.status(200).json({
        results:
          visibleItems.map(
            serializeWatchlistItem
          ),

        pagination: {
          page,
          limit,

          total:
            watchlist.length,

          totalPages:
            Math.ceil(
              watchlist.length /
                limit
            ),

          hasMore:
            start + limit <
            watchlist.length,
        },
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch TV watchlist"
      );
    }
  }
);

// ======================================================
// GET /api/tv-watchlist/status/:showTmdbId
//
// Checks whether a show is saved.
// ======================================================

router.get(
  "/status/:showTmdbId",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const showTmdbId =
        parsePositiveInteger(
          req.params.showTmdbId,
          "show ID"
        );

      const user =
        await User.findOne({
          _id: userId,

          "tvWatchlist.tmdbId":
            showTmdbId,
        })
          .select(
            "tvWatchlist.$"
          )
          .lean();

      const item =
        user?.tvWatchlist?.[0] ||
        null;

      return res.status(200).json({
        showTmdbId,

        saved:
          Boolean(item),

        item:
          item
            ? serializeWatchlistItem(
                item
              )
            : null,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to check TV watchlist status"
      );
    }
  }
);

// ======================================================
// POST /api/tv-watchlist
//
// Adds one show.
//
// Body:
// {
//   "showTmdbId": 1396
// }
//
// Optional snapshot fields are accepted, but local Show metadata
// is preferred when available.
// ======================================================

router.post(
  "/",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const showTmdbId =
        parsePositiveInteger(
          req.body?.showTmdbId ??
          req.body?.tmdbId,
          "show ID"
        );

      const [
        user,
        localShow,
      ] = await Promise.all([
        User.findById(userId),

        Show.findOne({
          tmdbId:
            showTmdbId,
        }).lean(),
      ]);

      if (!user) {
        return res.status(404).json({
          error:
            "User not found",
        });
      }

      if (
        !localShow &&
        !normalizeString(
          req.body?.name,
          500
        )
      ) {
        return res.status(404).json({
          error:
            "Show metadata not found. Open the show page before adding it to the watchlist.",
        });
      }

      if (
        !Array.isArray(
          user.tvWatchlist
        )
      ) {
        user.tvWatchlist = [];
      }

      const existingIndex =
        user.tvWatchlist.findIndex(
          (item) =>
            Number(item.tmdbId) ===
            showTmdbId
        );

      if (existingIndex >= 0) {
        return res.status(200).json({
          message:
            "Show is already in TV watchlist",

          added: false,

          item:
            serializeWatchlistItem(
              user.tvWatchlist[
                existingIndex
              ]
            ),
        });
      }

      const snapshot =
        buildWatchlistSnapshot({
          tmdbId:
            showTmdbId,

          localShow,

          input:
            req.body || {},
        });

      user.tvWatchlist.push(
        snapshot
      );

      await user.save();

      const addedItem =
        user.tvWatchlist.find(
          (item) =>
            Number(item.tmdbId) ===
            showTmdbId
        );

      return res.status(201).json({
        message:
          "Show added to TV watchlist",

        added: true,

        item:
          serializeWatchlistItem(
            addedItem
          ),

        total:
          user.tvWatchlist.length,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to add show to TV watchlist"
      );
    }
  }
);

// ======================================================
// PATCH /api/tv-watchlist/:showTmdbId
//
// Refreshes or changes the saved metadata snapshot.
// Does not change addedAt.
// ======================================================

router.patch(
  "/:showTmdbId",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const showTmdbId =
        parsePositiveInteger(
          req.params.showTmdbId,
          "show ID"
        );

      const [
        user,
        localShow,
      ] = await Promise.all([
        User.findById(userId),

        Show.findOne({
          tmdbId:
            showTmdbId,
        }).lean(),
      ]);

      if (!user) {
        return res.status(404).json({
          error:
            "User not found",
        });
      }

      const item =
        user.tvWatchlist.find(
          (entry) =>
            Number(
              entry.tmdbId
            ) === showTmdbId
        );

      if (!item) {
        return res.status(404).json({
          error:
            "Show is not in TV watchlist",
        });
      }

      const snapshot =
        buildWatchlistSnapshot({
          tmdbId:
            showTmdbId,

          localShow,

          input:
            req.body || {},
        });

      const originalAddedAt =
        item.addedAt;

      item.name =
        snapshot.name;

      item.nameAr =
        snapshot.nameAr;

      item.originalName =
        snapshot.originalName;

      item.posterPath =
        snapshot.posterPath;

      item.backdropPath =
        snapshot.backdropPath;

      item.firstAirDate =
        snapshot.firstAirDate;

      item.status =
        snapshot.status;

      item.voteAverage =
        snapshot.voteAverage;

      item.genres =
        snapshot.genres;

      item.addedAt =
        originalAddedAt ||
        new Date();

      await user.save();

      return res.status(200).json({
        message:
          "TV watchlist item updated",

        item:
          serializeWatchlistItem(
            item
          ),
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to update TV watchlist item"
      );
    }
  }
);

// ======================================================
// DELETE /api/tv-watchlist/:showTmdbId
//
// Removes one show.
// ======================================================

router.delete(
  "/:showTmdbId",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const showTmdbId =
        parsePositiveInteger(
          req.params.showTmdbId,
          "show ID"
        );

      const user =
        await User.findById(
          userId
        );

      if (!user) {
        return res.status(404).json({
          error:
            "User not found",
        });
      }

      const previousCount =
        Array.isArray(
          user.tvWatchlist
        )
          ? user.tvWatchlist.length
          : 0;

      user.tvWatchlist = (
        user.tvWatchlist || []
      ).filter(
        (item) =>
          Number(item.tmdbId) !==
          showTmdbId
      );

      const removed =
        user.tvWatchlist.length <
        previousCount;

      if (removed) {
        await user.save();
      }

      return res.status(200).json({
        message:
          removed
            ? "Show removed from TV watchlist"
            : "Show was not in TV watchlist",

        removed,

        showTmdbId,

        total:
          user.tvWatchlist.length,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to remove show from TV watchlist"
      );
    }
  }
);

// ======================================================
// GET /api/tv-watchlist/upcoming-episodes
//
// Derived tab—not stored in User.tvWatchlist.
//
// Returns the earliest unwatched aired regular episode for
// each started show.
//
// Specials are excluded because progress.nextUnwatchedEpisode
// is regular-episode based.
// ======================================================

router.get(
  "/upcoming-episodes",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const limit =
        parseLimit(
          req.query.limit,
          50
        );

      const progressDocuments =
        await UserShowProgress.find({
          user: userId,

          status: {
            $in: [
              "watching",
              "completed",
            ],
          },

          nextUnwatchedEpisode: {
            $ne: null,
          },

          "nextUnwatchedEpisode.airDate": {
            $ne: null,
            $lte: new Date(),
          },
        })
          .sort({
            "nextUnwatchedEpisode.airDate": 1,
            lastWatchedAt: -1,
          })
          .limit(limit)
          .lean();

      const results =
        progressDocuments
          .map(
            serializeUpcomingEpisode
          )
          .filter(Boolean);

      return res.status(200).json({
        results,

        count:
          results.length,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch Upcoming Episodes"
      );
    }
  }
);

// ======================================================
// GET /api/tv-watchlist/user/:username
//
// Public TV watchlist for another user's profile.
// ======================================================

router.get(
  "/user/:username",
  async (req, res) => {
    try {
      const cleanUsername =
        normalizeString(
          req.params.username,
          200
        );

      const page =
        parsePage(
          req.query.page
        );

      const limit =
        parseLimit(
          req.query.limit
        );

      const user =
        await User.findOne({
          username: {
            $regex:
              `^${escapeRegex(
                cleanUsername
              )}$`,

            $options: "i",
          },
        })
          .select(
            "username tvWatchlist"
          )
          .lean();

      if (!user) {
        return res.status(404).json({
          error:
            "User not found",
        });
      }

      const watchlist =
        Array.isArray(
          user.tvWatchlist
        )
          ? [...user.tvWatchlist]
          : [];

      watchlist.sort(
        (first, second) =>
          new Date(
            second.addedAt || 0
          ).getTime() -
          new Date(
            first.addedAt || 0
          ).getTime()
      );

      const start =
        (page - 1) *
        limit;

      const visibleItems =
        watchlist.slice(
          start,
          start + limit
        );

      return res.status(200).json({
        username:
          user.username,

        results:
          visibleItems.map(
            serializeWatchlistItem
          ),

        pagination: {
          page,
          limit,

          total:
            watchlist.length,

          totalPages:
            Math.ceil(
              watchlist.length /
                limit
            ),

          hasMore:
            start + limit <
            watchlist.length,
        },
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch user TV watchlist"
      );
    }
  }
);

// ======================================================
// Export
// ======================================================

module.exports = router;

