// src/routes/tvFeedRoutes.js

const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const protect = require(
  "../middleware/authMiddleware"
);

const User = require(
  "../models/user"
);

const TVLog = require(
  "../models/tvLog"
);

// ======================================================
// Constants
// ======================================================

const DEFAULT_LIMIT = 20;
const MAXIMUM_LIMIT = 50;

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

function parseBoolean(
  value,
  fallback = false
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  if (
    value === true ||
    value === "true" ||
    value === "1"
  ) {
    return true;
  }

  if (
    value === false ||
    value === "false" ||
    value === "0"
  ) {
    return false;
  }

  return fallback;
}

function includesObjectId(
  values,
  userId
) {
  if (
    !Array.isArray(values) ||
    !userId
  ) {
    return false;
  }

  return values.some(
    (value) =>
      String(
        value?._id ||
        value
      ) ===
      String(userId)
  );
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
 * Base64URL encoded JSON containing:
 * {
 *   watchedAt,
 *   createdAt,
 *   id
 * }
 *
 * Legacy ISO-date cursors remain supported.
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
  ).toString("base64url");
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

  // New compound cursor.
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
    // Fall through to legacy ISO-date support.
  }

  // Backward compatibility with the previous cursor format.
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

  // Previous API only supplied watchedAt.
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

  /*
   * Feed ordering:
   *
   * watchedAt DESC
   * createdAt DESC
   * _id DESC
   *
   * The next page must continue strictly after the final item.
   */
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

function buildVisibleUserIds({
  authenticatedUserId,
  following,
  includeSelf,
}) {
  const uniqueIds =
    new Set();

  for (
    const value of
      Array.isArray(following)
        ? following
        : []
  ) {
    const rawId =
      value?._id ||
      value;

    if (
      mongoose.isValidObjectId(
        rawId
      )
    ) {
      uniqueIds.add(
        String(rawId)
      );
    }
  }

  if (
    includeSelf &&
    mongoose.isValidObjectId(
      authenticatedUserId
    )
  ) {
    uniqueIds.add(
      String(
        authenticatedUserId
      )
    );
  }

  return [
    ...uniqueIds,
  ].map(
    (value) =>
      new mongoose.Types.ObjectId(
        value
      )
  );
}

async function getFeedUsers(logs) {
  const userIds = [
    ...new Set(
      logs
        .map(
          (log) =>
            String(
              log.user
            )
        )
        .filter(Boolean)
    ),
  ];

  if (
    userIds.length === 0
  ) {
    return new Map();
  }

  const users =
    await User.find({
      _id: {
        $in:
          userIds,
      },
    })
      .select(
        "username name avatar"
      )
      .lean();

  return new Map(
    users.map(
      (user) => [
        String(
          user._id
        ),
        user,
      ]
    )
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
// Feed-card serializer
// ======================================================

function serializeFeedCard(
  log,
  user,
  viewerUserId
) {
  const hasReview =
    hasReviewContent(log);

  const favoriteCharacterTag =
    getFavoriteCharacterTag(
      log.favoriteCharacter
    );

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

    type:
      hasReview
        ? "episode_review"
        : "episode_log",

    navigation: {
      screen:
        hasReview
          ? "EpisodeReview"
          : "Episode",

      params: {
        logId:
          hasReview
            ? String(
                log._id
              )
            : null,

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

    user: {
      id:
        user?._id
          ? String(
              user._id
            )
          : String(
              log.user
            ),

      username:
        user?.username ||
        "",

      name:
        user?.name ||
        "",

      avatar:
        user?.avatar ||
        "",
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

      firstAirDate:
        log.firstAirDate ||
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

      overview:
        log.episodeOverview ||
        "",

      airDate:
        log.episodeAirDate ||
        "",

      runtime:
        log.episodeRuntime ??
        null,

      stillPath:
        log.episodeStillPath ||
        "",

      displayBackdrop,
    },

    activity: {
      watchedAt:
        log.watchedAt,

      createdAt:
        log.createdAt,

      updatedAt:
        log.updatedAt,

      watchNumber:
        Number(
          log.watchNumber
        ) || 1,

      rewatch:
        Boolean(
          log.rewatch
        ),

      logMethod:
        log.logMethod ||
        "full",

      source:
        log.source ||
        "manual",
    },

    review: {
      hasReview,

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
          ? log.images
          : [],
    },

    favoriteCharacter:
      log.favoriteCharacter ||
      null,

    favoriteCharacterTag,

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

      likedByViewer:
        includesObjectId(
          log.likes,
          viewerUserId
        ),
    },
  };
}

// ======================================================
// GET /api/tv-feed
//
// Following-only feed.
//
// Query parameters:
// - limit=20
// - cursor=<opaque cursor returned by this route>
// - includeSelf=true
// - reviewsOnly=false
// - showTmdbId=1396
//
// Collapse rule:
// Latest TVLog per user + show + season + episode.
// ======================================================

router.get(
  "/",
  protect,
  async (req, res) => {
    try {
      const authenticatedUserId =
        getAuthenticatedUserId(
          req
        );

      if (
        !mongoose.isValidObjectId(
          authenticatedUserId
        )
      ) {
        return res
          .status(401)
          .json({
            error:
              "Authentication required",
          });
      }

      const currentUser =
        await User.findById(
          authenticatedUserId
        )
          .select(
            "following"
          )
          .lean();

      if (!currentUser) {
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

      const includeSelf =
        parseBoolean(
          req.query.includeSelf,
          true
        );

      const reviewsOnly =
        parseBoolean(
          req.query.reviewsOnly,
          false
        );

      const requestedShowTmdbId =
        Number(
          req.query.showTmdbId
        );

      const visibleUserIds =
        buildVisibleUserIds({
          authenticatedUserId,

          following:
            currentUser.following,

          includeSelf,
        });

      if (
        visibleUserIds.length ===
        0
      ) {
        return res
          .status(200)
          .json({
            results: [],
            count: 0,
            hasMore: false,
            nextCursor: null,

            filters: {
              includeSelf,
              reviewsOnly,
              showTmdbId:
                null,
            },
          });
      }

      const baseMatch = {
        user: {
          $in:
            visibleUserIds,
        },
      };

      const cursorMatch =
        buildCursorMatch(
          cursor
        );

      if (cursorMatch) {
        Object.assign(
          baseMatch,
          cursorMatch
        );
      }

      if (
        Number.isInteger(
          requestedShowTmdbId
        ) &&
        requestedShowTmdbId > 0
      ) {
        baseMatch.showTmdbId =
          requestedShowTmdbId;
      }

      if (reviewsOnly) {
        baseMatch.$or = [
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
        ];
      }

      const logs =
        await TVLog.aggregate([
          {
            $match:
              baseMatch,
          },

          {
            $sort: {
              watchedAt:
                -1,

              createdAt:
                -1,

              _id:
                -1,
            },
          },

          {
            $group: {
              _id: {
                user:
                  "$user",

                showTmdbId:
                  "$showTmdbId",

                seasonNumber:
                  "$seasonNumber",

                episodeNumber:
                  "$episodeNumber",
              },

              latestLog: {
                $first:
                  "$$ROOT",
              },
            },
          },

          {
            $replaceRoot: {
              newRoot:
                "$latestLog",
            },
          },

          {
            $sort: {
              watchedAt:
                -1,

              createdAt:
                -1,

              _id:
                -1,
            },
          },

          {
            $limit:
              limit + 1,
          },
        ]);

      const hasMore =
        logs.length > limit;

      const visibleLogs =
        hasMore
          ? logs.slice(
              0,
              limit
            )
          : logs;

      const userMap =
        await getFeedUsers(
          visibleLogs
        );

      const results =
        visibleLogs.map(
          (log) =>
            serializeFeedCard(
              log,

              userMap.get(
                String(
                  log.user
                )
              ) ||
                null,

              authenticatedUserId
            )
        );

      const finalLog =
        visibleLogs[
          visibleLogs.length - 1
        ];

      const nextCursor =
        hasMore &&
        finalLog
          ? encodeCursor(
              finalLog
            )
          : null;

      return res
        .status(200)
        .json({
          results,

          count:
            results.length,

          hasMore,

          nextCursor,

          filters: {
            includeSelf,
            reviewsOnly,

            showTmdbId:
              Number.isInteger(
                requestedShowTmdbId
              ) &&
              requestedShowTmdbId >
                0
                ? requestedShowTmdbId
                : null,
          },
        });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch TV feed"
      );
    }
  }
);

// ======================================================
// GET /api/tv-feed/show/:showTmdbId
//
// Followed-user activity for one show.
// ======================================================

router.get(
  "/show/:showTmdbId",
  protect,
  async (req, res) => {
    try {
      const authenticatedUserId =
        getAuthenticatedUserId(
          req
        );

      if (
        !mongoose.isValidObjectId(
          authenticatedUserId
        )
      ) {
        return res
          .status(401)
          .json({
            error:
              "Authentication required",
          });
      }

      const showTmdbId =
        Number(
          req.params.showTmdbId
        );

      if (
        !Number.isInteger(
          showTmdbId
        ) ||
        showTmdbId < 1
      ) {
        return res
          .status(400)
          .json({
            error:
              "Invalid show ID",
          });
      }

      const currentUser =
        await User.findById(
          authenticatedUserId
        )
          .select(
            "following"
          )
          .lean();

      if (!currentUser) {
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

      const includeSelf =
        parseBoolean(
          req.query.includeSelf,
          true
        );

      const visibleUserIds =
        buildVisibleUserIds({
          authenticatedUserId,

          following:
            currentUser.following,

          includeSelf,
        });

      if (
        visibleUserIds.length ===
        0
      ) {
        return res
          .status(200)
          .json({
            showTmdbId,
            results: [],
            count: 0,
          });
      }

      const logs =
        await TVLog.aggregate([
          {
            $match: {
              user: {
                $in:
                  visibleUserIds,
              },

              showTmdbId,
            },
          },

          {
            $sort: {
              watchedAt:
                -1,

              createdAt:
                -1,

              _id:
                -1,
            },
          },

          {
            $group: {
              _id: {
                user:
                  "$user",

                seasonNumber:
                  "$seasonNumber",

                episodeNumber:
                  "$episodeNumber",
              },

              latestLog: {
                $first:
                  "$$ROOT",
              },
            },
          },

          {
            $replaceRoot: {
              newRoot:
                "$latestLog",
            },
          },

          {
            $sort: {
              watchedAt:
                -1,

              createdAt:
                -1,

              _id:
                -1,
            },
          },

          {
            $limit:
              limit,
          },
        ]);

      const userMap =
        await getFeedUsers(
          logs
        );

      const results =
        logs.map(
          (log) =>
            serializeFeedCard(
              log,

              userMap.get(
                String(
                  log.user
                )
              ) ||
                null,

              authenticatedUserId
            )
        );

      return res
        .status(200)
        .json({
          showTmdbId,

          results,

          count:
            results.length,
        });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch show activity"
      );
    }
  }
);

// ======================================================
// GET /api/tv-feed/episode/:showTmdbId/:seasonNumber/:episodeNumber
//
// Latest activity per visible user for one episode.
// Useful for "Watched by Friends".
// ======================================================

router.get(
  "/episode/:showTmdbId/:seasonNumber/:episodeNumber",
  protect,
  async (req, res) => {
    try {
      const authenticatedUserId =
        getAuthenticatedUserId(
          req
        );

      

      if (
        !mongoose.isValidObjectId(
          authenticatedUserId
        )
      ) {
        return res
          .status(401)
          .json({
            error:
              "Authentication required",
          });
      }

      const showTmdbId =
        Number(
          req.params.showTmdbId
        );

      const seasonNumber =
        Number(
          req.params.seasonNumber
        );

      const episodeNumber =
        Number(
          req.params.episodeNumber
        );

      if (
        !Number.isInteger(
          showTmdbId
        ) ||
        showTmdbId < 1 ||
        !Number.isInteger(
          seasonNumber
        ) ||
        seasonNumber < 0 ||
        !Number.isInteger(
          episodeNumber
        ) ||
        episodeNumber < 1
      ) {
        return res
          .status(400)
          .json({
            error:
              "Invalid episode identity",
          });
      }

      const currentUser =
        await User.findById(
          authenticatedUserId
        )
          .select(
            "following"
          )
          .lean();

      if (!currentUser) {
        return res
          .status(404)
          .json({
            error:
              "User not found",
          });
      }

      const includeSelf =
        parseBoolean(
          req.query.includeSelf,
          true
        );

      const visibleUserIds =
        buildVisibleUserIds({
          authenticatedUserId,

          following:
            currentUser.following,

          includeSelf,
        });

      if (
        visibleUserIds.length ===
        0
      ) {
        return res
          .status(200)
          .json({
            showTmdbId,
            seasonNumber,
            episodeNumber,

            watchedByCount:
              0,

            results: [],
          });
      }

      const logs =
        await TVLog.aggregate([
          {
            $match: {
              user: {
                $in:
                  visibleUserIds,
              },

              showTmdbId,
              seasonNumber,
              episodeNumber,
            },
          },

          {
            $sort: {
              watchedAt:
                -1,

              createdAt:
                -1,

              _id:
                -1,
            },
          },

          {
            $group: {
              _id:
                "$user",

              latestLog: {
                $first:
                  "$$ROOT",
              },

              totalWatchCount: {
                $sum:
                  1,
              },
            },
          },

          {
            $replaceRoot: {
              newRoot: {
                $mergeObjects: [
                  "$latestLog",

                  {
                    collapsedWatchCount:
                      "$totalWatchCount",
                  },
                ],
              },
            },
          },

          {
            $sort: {
              watchedAt:
                -1,

              createdAt:
                -1,

              _id:
                -1,
            },
          },
        ]);

      const userMap =
        await getFeedUsers(
          logs
        );

      const results =
        logs.map(
          (log) => ({
            ...serializeFeedCard(
              log,

              userMap.get(
                String(
                  log.user
                )
              ) ||
                null,

              authenticatedUserId
            ),

            collapsedWatchCount:
              Number(
                log.collapsedWatchCount
              ) || 1,
          })
        );

      return res
        .status(200)
        .json({
          showTmdbId,
          seasonNumber,
          episodeNumber,

          watchedByCount:
            results.length,

          results,
        });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch episode activity"
      );
    }
  }
);

// ======================================================
// Export
// ======================================================

module.exports = router;
