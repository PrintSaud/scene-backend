// src/routes/tvProfileRoutes.js

const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const User = require(
  "../models/user"
);

const TVLog = require(
  "../models/tvLog"
);

const UserShowProgress = require(
  "../models/userShowProgress"
);

const {
  getTVProfileStats,
} = require(
  "../services/tvStatsService"
);

// ======================================================
// Constants
// ======================================================

const DEFAULT_LIMIT = 20;
const MAXIMUM_LIMIT = 50;

const VALID_SHOW_STATUSES =
  new Set([
    "watching",
    "completed",
  ]);

const VALID_SHOW_SORTS =
  new Set([
    "recent",
    "progress",
    "runtime",
    "rewatches",
  ]);

// ======================================================
// Helpers
// ======================================================

function escapeRegex(value) {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
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

function normalizeStatus(value) {
  if (
    typeof value !== "string"
  ) {
    return null;
  }

  const normalized =
    value.trim().toLowerCase();

  return VALID_SHOW_STATUSES.has(
    normalized
  )
    ? normalized
    : null;
}

function normalizeSort(value) {
  if (
    typeof value !== "string"
  ) {
    return "recent";
  }

  const normalized =
    value.trim().toLowerCase();

  return VALID_SHOW_SORTS.has(
    normalized
  )
    ? normalized
    : "recent";
}

function hasReviewContent(log) {
  return Boolean(
    (
      typeof log?.review ===
        "string" &&
      log.review.trim()
    ) ||
      (
        typeof log?.gif ===
          "string" &&
        log.gif.trim()
      ) ||
      (
        typeof log?.image ===
          "string" &&
        log.image.trim()
      ) ||
      (
        Array.isArray(
          log?.images
        ) &&
        log.images.some(
          (value) =>
            typeof value ===
              "string" &&
            value.trim()
        )
      )
  );
}

function getReviewMatch() {
  return {
    $or: [
      {
        review: {
          $type:
            "string",

          $ne:
            "",
        },
      },

      {
        gif: {
          $type:
            "string",

          $ne:
            "",
        },
      },

      {
        image: {
          $type:
            "string",

          $ne:
            "",
        },
      },

      {
        "images.0": {
          $exists:
            true,
        },
      },
    ],
  };
}

function getFavoriteCharacterTag(
  favoriteCharacter
) {
  const characterName =
    favoriteCharacter
      ?.characterName;

  if (
    typeof characterName !==
      "string" ||
    !characterName.trim()
  ) {
    return null;
  }

  const firstName =
    characterName
      .trim()
      .split(/\s+/)[0]
      .replace(
        /[^a-zA-Z0-9\u0600-\u06FF]/g,
        ""
      );

  return firstName
    ? `#Team${firstName}`
    : null;
}

/**
 * New cursor format:
 *
 * Base64URL encoded JSON:
 * {
 *   watchedAt,
 *   createdAt,
 *   id
 * }
 *
 * Legacy ISO watchedAt cursors remain supported.
 */
function encodeCursor(log) {
  if (!log) {
    return null;
  }

  const payload = {
    watchedAt:
      log.watchedAt ||
      log.createdAt ||
      null,

    createdAt:
      log.createdAt ||
      log.watchedAt ||
      null,

    id:
      String(log._id),
  };

  if (
    !payload.watchedAt ||
    !payload.createdAt ||
    !mongoose.isValidObjectId(
      payload.id
    )
  ) {
    return null;
  }

  return Buffer.from(
    JSON.stringify(payload),
    "utf8"
  ).toString(
    "base64url"
  );
}

function decodeCursor(value) {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    return null;
  }

  const normalized =
    value.trim();

  try {
    const decoded =
      Buffer.from(
        normalized,
        "base64url"
      ).toString("utf8");

    const payload =
      JSON.parse(decoded);

    const watchedAt =
      new Date(
        payload.watchedAt
      );

    const createdAt =
      new Date(
        payload.createdAt
      );

    if (
      !Number.isNaN(
        watchedAt.getTime()
      ) &&
      !Number.isNaN(
        createdAt.getTime()
      ) &&
      mongoose.isValidObjectId(
        payload.id
      )
    ) {
      return {
        watchedAt,
        createdAt,

        id:
          new mongoose.Types.ObjectId(
            payload.id
          ),

        legacy:
          false,
      };
    }
  } catch (error) {
    // Continue to legacy ISO cursor support.
  }

  const legacyDate =
    new Date(normalized);

  if (
    Number.isNaN(
      legacyDate.getTime()
    )
  ) {
    return null;
  }

  return {
    watchedAt:
      legacyDate,

    createdAt:
      null,

    id:
      null,

    legacy:
      true,
  };
}

function buildCursorMatch(cursor) {
  if (!cursor) {
    return null;
  }

  if (
    cursor.legacy ||
    !cursor.createdAt ||
    !cursor.id
  ) {
    return {
      watchedAt: {
        $lt:
          cursor.watchedAt,
      },
    };
  }

  return {
    $or: [
      {
        watchedAt: {
          $lt:
            cursor.watchedAt,
        },
      },

      {
        watchedAt:
          cursor.watchedAt,

        createdAt: {
          $lt:
            cursor.createdAt,
        },
      },

      {
        watchedAt:
          cursor.watchedAt,

        createdAt:
          cursor.createdAt,

        _id: {
          $lt:
            cursor.id,
        },
      },
    ],
  };
}

function getShowSort(sortType) {
  if (
    sortType === "progress"
  ) {
    return {
      progressPercentage:
        -1,

      watchedEpisodeCount:
        -1,

      lastWatchedAt:
        -1,

      _id:
        -1,
    };
  }

  if (
    sortType === "runtime"
  ) {
    return {
      totalWatchMinutes:
        -1,

      lastWatchedAt:
        -1,

      _id:
        -1,
    };
  }

  if (
    sortType === "rewatches"
  ) {
    return {
      rewatchCount:
        -1,

      totalWatchCount:
        -1,

      lastWatchedAt:
        -1,

      _id:
        -1,
    };
  }

  return {
    lastWatchedAt:
      -1,

    updatedAt:
      -1,

    _id:
      -1,
  };
}

async function findUserByUsername(
  username
) {
  if (
    typeof username !==
      "string" ||
    !username.trim()
  ) {
    return null;
  }

  const cleanUsername =
    username.trim();

  return User.findOne({
    username: {
      $regex:
        `^${escapeRegex(
          cleanUsername
        )}$`,

      $options:
        "i",
    },
  })
    .select(
      [
        "username",
        "name",
        "bio",
        "avatar",
        "language",
        "preferredMode",
        "tvProfileBackdrop",
        "favoriteShows",
        "tvWatchlist",
        "followers",
        "following",
        "createdAt",
      ].join(" ")
    )
    .lean({
      virtuals:
        true,
    });
}

function serializeProfileUser(user) {
  return {
    id:
      String(user._id),

    username:
      user.username ||
      "",

    name:
      user.name ||
      "",

    bio:
      user.bio ||
      "",

    avatar:
      user.avatar ||
      "",

    language:
      user.language ||
      "en",

    preferredMode:
      user.preferredMode ||
      "movies",

    tvProfileBackdrop:
      user.tvProfileBackdrop ||
      "",

    favoriteShows:
      Array.isArray(
        user.favoriteShows
      )
        ? user.favoriteShows.slice(
            0,
            4
          )
        : [],

    social: {
      followerCount:
        Array.isArray(
          user.followers
        )
          ? user.followers.length
          : 0,

      followingCount:
        Array.isArray(
          user.following
        )
          ? user.following.length
          : 0,
    },

    joinedAt:
      user.createdAt ||
      null,
  };
}

function serializeShowProgress(
  progress
) {
  const nextEpisode =
    progress.nextUnwatchedEpisode ||
    null;

  return {
    id:
      String(progress._id),

    show: {
      id:
        progress.show
          ? String(
              progress.show
            )
          : null,

      tmdbId:
        progress.showTmdbId,

      name:
        progress.showName ||
        "",

      nameAr:
        progress.showNameAr ||
        "",

      posterPath:
        progress.posterPath ||
        "",

      backdropPath:
        progress.backdropPath ||
        "",

      firstAirDate:
        progress.firstAirDate ||
        null,
    },

    progress: {
      status:
        progress.status ||
        "watching",

      percentage:
        Number(
          progress.progressPercentage
        ) || 0,

      watchedEpisodeCount:
        Number(
          progress.watchedEpisodeCount
        ) || 0,

      watchedSpecialCount:
        Number(
          progress.watchedSpecialCount
        ) || 0,

      airedEpisodeCount:
        Number(
          progress.airedEpisodeCount
        ) || 0,

      totalEpisodeCount:
        Number(
          progress.totalEpisodeCount
        ) || 0,

      completedSeasonCount:
        Number(
          progress.completedSeasonCount
        ) || 0,

      airedSeasonCount:
        Number(
          progress.airedSeasonCount
        ) || 0,

      isCaughtUp:
        Boolean(
          progress.isCaughtUp
        ),
    },

    watches: {
      total:
        Number(
          progress.totalWatchCount
        ) || 0,

      rewatches:
        Number(
          progress.rewatchCount
        ) || 0,

      minutes:
        Number(
          progress.totalWatchMinutes
        ) || 0,
    },

    latest: {
      logId:
        progress.lastLog
          ? String(
              progress.lastLog
            )
          : null,

      watchedAt:
        progress.lastWatchedAt ||
        null,

      seasonNumber:
        progress.lastSeasonNumber ??
        null,

      episodeNumber:
        progress.lastEpisodeNumber ??
        null,

      episodeTmdbId:
        progress.lastEpisodeTmdbId ??
        null,

      episodeName:
        progress.lastEpisodeName ||
        "",

      episodeStillPath:
        progress.lastEpisodeStillPath ||
        "",

      watchNumber:
        Number(
          progress.lastWatchNumber
        ) || 1,

      rewatch:
        Boolean(
          progress.lastWasRewatch
        ),
    },

    nextUnwatchedEpisode:
      nextEpisode,

    nextScheduledEpisode:
      progress.nextScheduledEpisode ||
      null,

    startedAt:
      progress.startedAt ||
      null,

    firstCompletedAt:
      progress.firstCompletedAt ||
      null,

    navigation: {
      show: {
        screen:
          "Show",

        params: {
          showTmdbId:
            progress.showTmdbId,
        },
      },

      nextEpisode:
        nextEpisode
          ? {
              screen:
                "Episode",

              params: {
                showTmdbId:
                  progress.showTmdbId,

                seasonNumber:
                  nextEpisode
                    .seasonNumber,

                episodeNumber:
                  nextEpisode
                    .episodeNumber,

                episodeTmdbId:
                  nextEpisode
                    .episodeTmdbId ??
                  null,
              },
            }
          : null,
    },
  };
}

function serializeReview(log) {
  const displayBackdrop =
    log.customEpisodeBackdrop ||
    log.episodeStillPath ||
    log.showBackdrop ||
    "";

  const displayPoster =
    log.customShowPoster ||
    log.showPoster ||
    "";

  return {
    id:
      String(log._id),

    navigation: {
      screen:
        "EpisodeReview",

      params: {
        logId:
          String(log._id),

        showTmdbId:
          log.showTmdbId,

        seasonNumber:
          log.seasonNumber,

        episodeNumber:
          log.episodeNumber,

        episodeTmdbId:
          log.episodeTmdbId ??
          null,
      },
    },

    show: {
      id:
        log.show
          ? String(
              log.show
            )
          : null,

      tmdbId:
        log.showTmdbId,

      name:
        log.showName ||
        "",

      posterPath:
        log.showPoster ||
        "",

      backdropPath:
        log.showBackdrop ||
        "",

      displayPoster,
    },

    episode: {
      tmdbId:
        log.episodeTmdbId ??
        null,

      seasonNumber:
        log.seasonNumber,

      episodeNumber:
        log.episodeNumber,

      code:
        `S${log.seasonNumber}E${log.episodeNumber}`,

      name:
        log.episodeName ||
        "",

      stillPath:
        log.episodeStillPath ||
        "",

      runtime:
        log.episodeRuntime ??
        null,

      displayBackdrop,
    },

    review: {
      text:
        log.review ||
        "",

      rating:
        log.rating ??
        null,

      containsSpoilers:
        Boolean(
          log.containsSpoilers
        ),

      gif:
        log.gif ||
        "",

      image:
        log.image ||
        "",

      images:
        Array.isArray(
          log.images
        )
          ? log.images.filter(
              (value) =>
                typeof value ===
                  "string" &&
                value.trim()
            )
          : [],
    },

    activity: {
      watchedAt:
        log.watchedAt,

      createdAt:
        log.createdAt,

      watchNumber:
        Number(
          log.watchNumber
        ) || 1,

      rewatch:
        Boolean(
          log.rewatch
        ),
    },

    favoriteCharacter:
      log.favoriteCharacter ||
      null,

    favoriteCharacterTag:
      getFavoriteCharacterTag(
        log.favoriteCharacter
      ),

    engagement: {
      likeCount:
        Array.isArray(
          log.likes
        )
          ? log.likes.length
          : 0,

      replyCount:
        Array.isArray(
          log.replies
        )
          ? log.replies.length
          : 0,
    },
  };
}

function normalizeWatchlist(
  value
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(Boolean)
    .slice()
    .sort(
      (
        first,
        second
      ) =>
        new Date(
          second?.addedAt ||
          0
        ).getTime() -
        new Date(
          first?.addedAt ||
          0
        ).getTime()
    );
}

function handleError(
  error,
  res,
  fallbackMessage
) {
  console.error(
    `❌ ${fallbackMessage}:`,
    error?.stack ||
    error
  );

  return res
    .status(500)
    .json({
      error:
        fallbackMessage,

      details:
        process.env.NODE_ENV ===
        "production"
          ? undefined
          : error?.message ||
            undefined,
    });
}

// ======================================================
// GET /api/tv-profile/:username/shows
//
// TV Profile → Shows.
// ======================================================

router.get(
  "/:username/shows",
  async (req, res) => {
    try {
      const user =
        await findUserByUsername(
          req.params.username
        );

      if (!user) {
        return res
          .status(404)
          .json({
            error:
              "User not found",
          });
      }

      const page =
        parsePage(
          req.query.page
        );

      const limit =
        parseLimit(
          req.query.limit
        );

      const status =
        normalizeStatus(
          req.query.status
        );

      const sortType =
        normalizeSort(
          req.query.sort
        );

      const match = {
        user:
          user._id,
      };

      if (status) {
        match.status =
          status;
      }

      const sort =
        getShowSort(
          sortType
        );

      const skip =
        (page - 1) *
        limit;

      const [
        progressDocuments,
        total,
      ] = await Promise.all([
        UserShowProgress.find(
          match
        )
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(),

        UserShowProgress
          .countDocuments(
            match
          ),
      ]);

      const totalPages =
        total > 0
          ? Math.ceil(
              total / limit
            )
          : 0;

      return res
        .status(200)
        .json({
          username:
            user.username,

          results:
            progressDocuments.map(
              serializeShowProgress
            ),

          pagination: {
            page,
            limit,
            total,
            totalPages,

            hasMore:
              page * limit <
              total,
          },

          filters: {
            status,
            sort:
              sortType,
          },
        });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch profile shows"
      );
    }
  }
);

// ======================================================
// GET /api/tv-profile/:username/reviews
//
// TV Profile → Reviews.
// ======================================================

router.get(
  "/:username/reviews",
  async (req, res) => {
    try {
      const user =
        await findUserByUsername(
          req.params.username
        );

      if (!user) {
        return res
          .status(404)
          .json({
            error:
              "User not found",
          });
      }

      const limit =
        parseLimit(
          req.query.limit
        );

      const cursor =
        decodeCursor(
          req.query.cursor
        );

      const match = {
        user:
          user._id,

        ...getReviewMatch(),
      };

      const cursorMatch =
        buildCursorMatch(
          cursor
        );

      if (cursorMatch) {
        const reviewConditions =
          match.$or;

        delete match.$or;

        match.$and = [
          {
            $or:
              reviewConditions,
          },

          cursorMatch,
        ];
      }

      const logs =
        await TVLog.find(
          match
        )
          .sort({
            watchedAt:
              -1,

            createdAt:
              -1,

            _id:
              -1,
          })
          .limit(
            limit + 1
          )
          .lean({
            virtuals:
              true,
          });

      const hasMore =
        logs.length > limit;

      const visibleLogs =
        hasMore
          ? logs.slice(
              0,
              limit
            )
          : logs;

      const results =
        visibleLogs
          .filter(
            hasReviewContent
          )
          .map(
            serializeReview
          );

      const lastLog =
        visibleLogs[
          visibleLogs.length - 1
        ];

      return res
        .status(200)
        .json({
          username:
            user.username,

          results,

          count:
            results.length,

          hasMore,

          nextCursor:
            hasMore &&
            lastLog
              ? encodeCursor(
                  lastLog
                )
              : null,
        });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch profile TV reviews"
      );
    }
  }
);

// ======================================================
// GET /api/tv-profile/:username/watchlist
//
// TV Profile → Watchlist.
// ======================================================

router.get(
  "/:username/watchlist",
  async (req, res) => {
    try {
      const user =
        await findUserByUsername(
          req.params.username
        );

      if (!user) {
        return res
          .status(404)
          .json({
            error:
              "User not found",
          });
      }

      const page =
        parsePage(
          req.query.page
        );

      const limit =
        parseLimit(
          req.query.limit
        );

      const watchlist =
        normalizeWatchlist(
          user.tvWatchlist
        );

      const start =
        (page - 1) *
        limit;

      const results =
        watchlist.slice(
          start,
          start + limit
        );

      const total =
        watchlist.length;

      const totalPages =
        total > 0
          ? Math.ceil(
              total / limit
            )
          : 0;

      return res
        .status(200)
        .json({
          username:
            user.username,

          results,

          pagination: {
            page,
            limit,
            total,
            totalPages,

            hasMore:
              start +
                limit <
              total,
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
// GET /api/tv-profile/:username/top-four
// ======================================================

router.get(
  "/:username/top-four",
  async (req, res) => {
    try {
      const user =
        await findUserByUsername(
          req.params.username
        );

      if (!user) {
        return res
          .status(404)
          .json({
            error:
              "User not found",
          });
      }

      return res
        .status(200)
        .json({
          username:
            user.username,

          backdrop:
            user.tvProfileBackdrop ||
            "",

          favoriteShows:
            Array.isArray(
              user.favoriteShows
            )
              ? user.favoriteShows.slice(
                  0,
                  4
                )
              : [],
        });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch TV Top Four"
      );
    }
  }
);

// ======================================================
// GET /api/tv-profile/:username
//
// Complete TV profile overview.
// Keep the generic username route after all specific routes.
// ======================================================

router.get(
  "/:username",
  async (req, res) => {
    try {
      const user =
        await findUserByUsername(
          req.params.username
        );

      if (!user) {
        return res
          .status(404)
          .json({
            error:
              "User not found",
          });
      }

      const reviewMatch = {
        user:
          user._id,

        ...getReviewMatch(),
      };

      const [
        stats,
        recentShows,
        recentReviews,
      ] = await Promise.all([
        getTVProfileStats(
          user._id
        ),

        UserShowProgress.find({
          user:
            user._id,
        })
          .sort({
            lastWatchedAt:
              -1,

            updatedAt:
              -1,

            _id:
              -1,
          })
          .limit(10)
          .lean(),

        TVLog.find(
          reviewMatch
        )
          .sort({
            watchedAt:
              -1,

            createdAt:
              -1,

            _id:
              -1,
          })
          .limit(6)
          .lean({
            virtuals:
              true,
          }),
      ]);

      const watchlist =
        normalizeWatchlist(
          user.tvWatchlist
        );

      const topFour =
        Array.isArray(
          user.favoriteShows
        )
          ? user.favoriteShows.slice(
              0,
              4
            )
          : [];

      return res
        .status(200)
        .json({
          user:
            serializeProfileUser(
              user
            ),

          stats,

          topFour,

          recentShows:
            recentShows.map(
              serializeShowProgress
            ),

          recentReviews:
            recentReviews
              .filter(
                hasReviewContent
              )
              .map(
                serializeReview
              ),

          watchlistPreview:
            watchlist.slice(
              0,
              10
            ),
        });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch TV profile"
      );
    }
  }
);

// ======================================================
// Export
// ======================================================

module.exports = router;

