// src/routes/tvLogRoutes.js

const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const protect = require(
  "../middleware/authMiddleware"
);

const TVLog = require(
  "../models/tvLog"
);


const User = require(
  "../models/user"
);

const Notification = require(
  "../models/notification"
);

const sendNotification = require(
  "../utils/sendNotification"
);

const {
  TVLogServiceError,

  createEpisodeLog,
  createQuickEpisodeLog,
  bulkLogAiredSeasonEpisodes,
  bulkLogAiredShowEpisodes,

  updateEpisodeLog,
  deleteEpisodeLog,
  deleteEpisodeHistory,

  getEpisodeWatchHistory,
  getEpisodeLogById,
  getLatestEpisodeLog,
} = require(
  "../services/tvLogService"
);

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

function normalizeString(
  value,
  maximumLength = 5000
) {
  if (
    typeof value !== "string"
  ) {
    return "";
  }

  return value
    .trim()
    .slice(
      0,
      maximumLength
    );
}

function includesObjectId(
  values,
  userId
) {
  return Array.isArray(values)
    ? values.some(
        (value) =>
          String(
            value?._id ||
            value
          ) ===
          String(userId)
      )
    : false;
}

function removeObjectId(
  values,
  userId
) {
  return (
    Array.isArray(values)
      ? values
      : []
  ).filter(
    (value) =>
      String(
        value?._id ||
        value
      ) !==
      String(userId)
  );
}

function serializeReply(
  reply,
  viewerUserId = null
) {
  const populatedUser =
    reply.user &&
    typeof reply.user ===
      "object" &&
    reply.user._id
      ? reply.user
      : null;

  return {
    id:
      String(reply._id),

    user: {
      id:
        populatedUser
          ? String(
              populatedUser._id
            )
          : String(
              reply.user
            ),

      username:
        populatedUser?.username ||
        "",

      name:
        populatedUser?.name ||
        "",

      avatar:
        populatedUser?.avatar ||
        "",
    },

    text:
      reply.text || "",

    gif:
      reply.gif || "",

    image:
      reply.image || "",

    rating:
      reply.rating ??
      null,

    favoriteCharacter:
      reply.favoriteCharacter ||
      null,

    teamTag:
      reply.teamTag ||
      getEpisodeTeamTag(
        reply.favoriteCharacter
      ),

    parentComment:
      reply.parentComment
        ? String(
            reply.parentComment
          )
        : null,

    likeCount:
      Array.isArray(
        reply.likes
      )
        ? reply.likes.length
        : 0,

    likedByViewer:
      viewerUserId
        ? includesObjectId(
            reply.likes,
            viewerUserId
          )
        : false,

    createdAt:
      reply.createdAt ||
      null,

    updatedAt:
      reply.updatedAt ||
      null,
  };
}

function getEpisodeTeamTag(
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

  const cleaned =
    characterName
      .trim()
      .replace(/\s+/g, "");

  return cleaned
    ? `#Team${cleaned}`
    : null;
}

async function enrichEpisodeRepliesWithReviewerData(
  logs
) {
  const logList =
    Array.isArray(logs)
      ? logs
      : logs
      ? [logs]
      : [];

  if (!logList.length) {
    return logs;
  }

  const groups =
    new Map();

  for (const log of logList) {
    const showTmdbId =
      Number(log?.showTmdbId);

    const seasonNumber =
      Number(log?.seasonNumber);

    const episodeNumber =
      Number(log?.episodeNumber);

    if (
      !Number.isInteger(showTmdbId) ||
      showTmdbId < 1 ||
      !Number.isInteger(seasonNumber) ||
      seasonNumber < 0 ||
      !Number.isInteger(episodeNumber) ||
      episodeNumber < 1
    ) {
      continue;
    }

    const replyUserIds = [
      ...new Set(
        (
          Array.isArray(log?.replies)
            ? log.replies
            : []
        )
          .map(
            (reply) =>
              reply?.user?._id ||
              reply?.user?.id ||
              reply?.user
          )
          .filter(Boolean)
          .map(String)
      ),
    ];

    if (!replyUserIds.length) {
      continue;
    }

    const key =
      `${showTmdbId}:${seasonNumber}:${episodeNumber}`;

    if (!groups.has(key)) {
      groups.set(key, {
        showTmdbId,
        seasonNumber,
        episodeNumber,
        userIds: new Set(),
        logs: [],
      });
    }

    const group =
      groups.get(key);

    replyUserIds.forEach(
      (userId) =>
        group.userIds.add(
          String(userId)
        )
    );

    group.logs.push(log);
  }

  for (const group of groups.values()) {
    const reviewerLogs =
      await TVLog.find({
        showTmdbId:
          group.showTmdbId,

        seasonNumber:
          group.seasonNumber,

        episodeNumber:
          group.episodeNumber,

        user: {
          $in: [
            ...group.userIds,
          ],
        },
      })
        .select(
          "user rating favoriteCharacter watchedAt createdAt"
        )
        .sort({
          watchedAt: -1,
          createdAt: -1,
          _id: -1,
        })
        .lean();

    const latestByUser =
      new Map();

    for (
      const reviewerLog of
      reviewerLogs
    ) {
      const reviewerUserId =
        String(
          reviewerLog?.user?._id ||
          reviewerLog?.user ||
          ""
        );

      if (
        !reviewerUserId ||
        latestByUser.has(
          reviewerUserId
        )
      ) {
        continue;
      }

      latestByUser.set(
        reviewerUserId,
        {
          rating:
            reviewerLog?.rating ??
            null,

          favoriteCharacter:
            reviewerLog
              ?.favoriteCharacter ||
            null,

          teamTag:
            getEpisodeTeamTag(
              reviewerLog
                ?.favoriteCharacter
            ),
        }
      );
    }

    for (
      const targetLog of
      group.logs
    ) {
      if (
        !Array.isArray(
          targetLog?.replies
        )
      ) {
        continue;
      }

      for (
        const reply of
        targetLog.replies
      ) {
        const replyUserId =
          String(
            reply?.user?._id ||
            reply?.user?.id ||
            reply?.user ||
            ""
          );

        const metadata =
          latestByUser.get(
            replyUserId
          );

        reply.rating =
          metadata?.rating ??
          null;

        reply.favoriteCharacter =
          metadata
            ?.favoriteCharacter ||
          null;

        reply.teamTag =
          metadata?.teamTag ||
          null;
      }
    }
  }

  return logs;
}

function serializeEpisodeReview(
  log,
  viewerUserId = null
) {
  const populatedUser =
    log.user &&
    typeof log.user ===
      "object" &&
    log.user._id
      ? log.user
      : null;

  const replies =
    Array.isArray(
      log.replies
    )
      ? log.replies
      : [];

  return {
    id:
      String(log._id),

    user: {
      id:
        populatedUser
          ? String(
              populatedUser._id
            )
          : String(
              log.user
            ),

      username:
        populatedUser?.username ||
        "",

      name:
        populatedUser?.name ||
        "",

      avatar:
        populatedUser?.avatar ||
        "",
    },

    show: {
      tmdbId:
        log.showTmdbId,

      name:
        log.showName ||
        "",

      poster:
        log.customShowPoster ||
        log.showPoster ||
        "",

      backdrop:
        log.showBackdrop ||
        "",
    },

    episode: {
      tmdbId:
        log.episodeTmdbId ||
        null,

      seasonNumber:
        log.seasonNumber,

      episodeNumber:
        log.episodeNumber,

      name:
        log.episodeName ||
        "",

      still:
        log.customEpisodeBackdrop ||
        log.episodeStillPath ||
        log.showBackdrop ||
        "",
    },

    rating:
      log.rating ??
      null,

    review:
      log.review ||
      "",

    containsSpoilers:
      Boolean(
        log.containsSpoilers
      ),

    favoriteCharacter:
      log.favoriteCharacter ||
      null,

    teamTag:
      getEpisodeTeamTag(
        log.favoriteCharacter
      ),

    media: {
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

    engagement: {
      likeCount:
        Array.isArray(
          log.likes
        )
          ? log.likes.length
          : 0,

      replyCount:
        replies.length,

      likedByViewer:
        viewerUserId
          ? includesObjectId(
              log.likes,
              viewerUserId
            )
          : false,
    },

    replies:
      replies.map((reply) =>
        serializeReply(
          reply,
          viewerUserId
        )
      ),

    watchNumber:
      Number(
        log.watchNumber
      ) || 1,

    watchedAt:
      log.watchedAt ||
      null,

    createdAt:
      log.createdAt ||
      null,

    updatedAt:
      log.updatedAt ||
      null,

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
      },
    },
  };
}

function buildEpisodeNotificationPayload(
  log
) {
  return {
    mediaType:
      "tv",

    showId:
      String(
        log.showTmdbId
      ),

    showTitle:
      log.showName ||
      "",

    showPoster:
      log.customShowPoster ||
      log.showPoster ||
      "",

    showBackdrop:
      log.showBackdrop ||
      "",

    seasonNumber:
      log.seasonNumber,

    episodeNumber:
      log.episodeNumber,

    episodeId:
      log.episodeTmdbId
        ? String(
            log.episodeTmdbId
          )
        : "",

    episodeTitle:
      log.episodeName ||
      "",

    episodeBackdrop:
      log.customEpisodeBackdrop ||
      log.episodeStillPath ||
      log.showBackdrop ||
      "",

    tvLogId:
      log._id,
  };
}

function handleServiceError(
  error,
  res,
  fallbackMessage
) {
  if (
    error instanceof
    TVLogServiceError
  ) {
    return res
      .status(
        error.statusCode ||
        400
      )
      .json({
        error:
          error.message,

        code:
          error.code,

        details:
          error.details ||
          null,
      });
  }

  if (
    error?.statusCode
  ) {
    return res
      .status(
        error.statusCode
      )
      .json({
        error:
          error.message,
      });
  }

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
    });
}

// ======================================================
// POST /api/tv-logs
//
// Full episode logging screen.
// ======================================================

router.post(
  "/",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const {
        showTmdbId,
        seasonNumber,
        episodeNumber,

        rating,
        review,
        containsSpoilers,
        watchedAt,

        gif,
        image,
        images,

        favoriteCharacter,

        customEpisodeBackdrop,
        customShowPoster,
      } = req.body;

      const logInput = {
        rating,
        review,
        containsSpoilers,
        watchedAt,
      
        gif,
        image,
        images,
      
        favoriteCharacter,
      };
      
      /*
       * Preserve the difference between:
       *
       * omitted artwork field
       *   → inherit the user's saved artwork
       *
       * explicitly supplied artwork field, including ""
       *   → use that exact value and bypass the saved default
       */
      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "customEpisodeBackdrop"
        )
      ) {
        logInput.customEpisodeBackdrop =
          customEpisodeBackdrop;
      }
      
      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "customShowPoster"
        )
      ) {
        logInput.customShowPoster =
          customShowPoster;
      }
      
      const result =
        await createEpisodeLog({
          userId,
          showTmdbId,
          seasonNumber,
          episodeNumber,
      
          input:
            logInput,
      
          logMethod:
            "full",
      
          source:
            "manual",
        });

      return res
        .status(201)
        .json({
          message:
            result.log
              .watchNumber > 1
              ? "Episode rewatch logged"
              : "Episode logged",

          log:
            result.log,

          progress:
            result.progress,
        });
    } catch (error) {
      return handleServiceError(
        error,
        res,
        "Failed to log episode"
      );
    }
  }
);

// ======================================================
// POST /api/tv-logs/quick
//
// Upcoming Episodes quick-eye action.
// ======================================================

router.post(
  "/quick",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const {
        showTmdbId,
        seasonNumber,
        episodeNumber,
        watchedAt,
      } = req.body;

      const result =
        await createQuickEpisodeLog({
          userId,
          showTmdbId,
          seasonNumber,
          episodeNumber,
          watchedAt,
        });

      return res
        .status(201)
        .json({
          message:
            "Episode marked watched",

          log:
            result.log,

          progress:
            result.progress,
        });
    } catch (error) {
      return handleServiceError(
        error,
        res,
        "Failed to mark episode watched"
      );
    }
  }
);

// ======================================================
// POST /api/tv-logs/bulk-season
//
// Logs every currently aired, unlogged episode.
// Never creates rewatches.
// ======================================================

router.post(
  "/bulk-season",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const {
        showTmdbId,
        seasonNumber,
        watchedAt,
      } = req.body;

      const result =
        await bulkLogAiredSeasonEpisodes({
          userId,
          showTmdbId,
          seasonNumber,
          watchedAt,
        });

      return res
        .status(201)
        .json({
          message:
            result.createdCount > 0
              ? `${result.createdCount} episodes marked watched`
              : "All aired episodes were already watched",

          createdCount:
            result.createdCount,

          skippedCount:
            result.skippedCount,

          createdLogs:
            result.createdLogs,

          progress:
            result.progress,
        });
    } catch (error) {
      return handleServiceError(
        error,
        res,
        "Failed to mark season watched"
      );
    }
  }
);

// ======================================================
// POST /api/tv-logs/bulk-show
//
// Logs every currently aired, unlogged episode across
// every normal season. Never creates rewatches.
// ======================================================

router.post(
  "/bulk-show",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const {
        showTmdbId,
        watchedAt,
      } = req.body;

      const result =
        await bulkLogAiredShowEpisodes({
          userId,
          showTmdbId,
          watchedAt,
        });

      return res
        .status(201)
        .json({
          message:
            result.createdCount > 0
              ? `${result.createdCount} episodes marked watched`
              : "All aired episodes were already watched",

          createdCount:
            result.createdCount,

          skippedCount:
            result.skippedCount,

          seasonCount:
            result.seasonCount,

          airedEpisodeCount:
            result.airedEpisodeCount,

          createdLogs:
            result.createdLogs,

          progress:
            result.progress,
        });
    } catch (error) {
      console.error(
        "❌ BULK SHOW QUICK LOG ERROR:",
        {
          message: error?.message,
          code: error?.code,
          statusCode: error?.statusCode,
          stack: error?.stack,
          body: req.body,
          userId: getAuthenticatedUserId(req),
          errors: error?.errors,
          writeErrors: error?.writeErrors,
        }
      );

      return handleServiceError(
        error,
        res,
        "Failed to mark show watched"
      );
    }
  }
);

// ======================================================
// GET /api/tv-logs/episode/:showTmdbId/:seasonNumber/:episodeNumber/history
//
// Authenticated user's complete episode watch history.
// ======================================================

router.get(
  "/episode/:showTmdbId/:seasonNumber/:episodeNumber/history",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const result =
        await getEpisodeWatchHistory({
          userId,

          showTmdbId:
            req.params
              .showTmdbId,

          seasonNumber:
            req.params
              .seasonNumber,

          episodeNumber:
            req.params
              .episodeNumber,
        });

      return res
        .status(200)
        .json(result);
    } catch (error) {
      return handleServiceError(
        error,
        res,
        "Failed to fetch episode watch history"
      );
    }
  }
);

// ======================================================
// GET /api/tv-logs/episode/:showTmdbId/:seasonNumber/:episodeNumber/latest
//
// Latest log for the authenticated user.
// ======================================================

router.get(
  "/episode/:showTmdbId/:seasonNumber/:episodeNumber/latest",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const log =
        await getLatestEpisodeLog({
          userId,

          showTmdbId:
            req.params
              .showTmdbId,

          seasonNumber:
            req.params
              .seasonNumber,

          episodeNumber:
            req.params
              .episodeNumber,
        });

      return res
        .status(200)
        .json({
          log,
        });
    } catch (error) {
      return handleServiceError(
        error,
        res,
        "Failed to fetch latest episode log"
      );
    }
  }
);

// ======================================================
// GET /api/tv-logs/episode/:showTmdbId/:seasonNumber/:episodeNumber/friends
//
// Ratings and reviews from users the current user follows.
// One latest rated/reviewed log per followed user.
// ======================================================

router.get(
  "/episode/:showTmdbId/:seasonNumber/:episodeNumber/friends",
  protect,
  async (req, res) => {
    try {
      const viewerUserId =
        getAuthenticatedUserId(req);

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
        !Number.isInteger(showTmdbId) ||
        showTmdbId < 1 ||
        !Number.isInteger(seasonNumber) ||
        seasonNumber < 0 ||
        !Number.isInteger(episodeNumber) ||
        episodeNumber < 1
      ) {
        return res.status(400).json({
          error:
            "Invalid show, season, or episode number",
        });
      }

      const currentUser =
        await User.findById(
          viewerUserId
        )
          .select("following")
          .lean();

      if (!currentUser) {
        return res.status(404).json({
          error:
            "User not found",
        });
      }

      const following =
        Array.isArray(
          currentUser.following
        )
          ? currentUser.following
          : [];

      if (!following.length) {
        return res.status(200).json({
          showTmdbId,
          seasonNumber,
          episodeNumber,
          results: [],
          count: 0,
        });
      }

      const logs =
        await TVLog.find({
          showTmdbId,
          seasonNumber,
          episodeNumber,

          user: {
            $in: following,
          },

          $or: [
            {
              rating: {
                $ne: null,
              },
            },

            {
              review: {
                $nin: [
                  null,
                  "",
                ],
              },
            },

            {
              gif: {
                $nin: [
                  null,
                  "",
                ],
              },
            },

            {
              image: {
                $nin: [
                  null,
                  "",
                ],
              },
            },
          ],
        })
          .sort({
            watchedAt: -1,
            createdAt: -1,
            _id: -1,
          })
          .populate(
            "user",
            "username name avatar"
          )
          .populate(
            "replies.user",
            "username name avatar"
          )
          .lean({
            virtuals: true,
          });

      // A user may have multiple rewatches.
      // Display only their latest meaningful log.
      const uniqueByUser =
        new Map();

      for (const log of logs) {
        const userId =
          String(
            log.user?._id ||
            log.user ||
            ""
          );

        if (
          !userId ||
          uniqueByUser.has(userId)
        ) {
          continue;
        }

        uniqueByUser.set(
          userId,
          log
        );
      }

      const uniqueLogs =
        Array.from(
          uniqueByUser.values()
        );

      await enrichEpisodeRepliesWithReviewerData(
        uniqueLogs
      );

      const results =
        uniqueLogs.map((log) =>
          serializeEpisodeReview(
            log,
            viewerUserId
          )
        );

      return res.status(200).json({
        showTmdbId,
        seasonNumber,
        episodeNumber,
        results,
        count:
          results.length,
      });
    } catch (error) {
      return handleServiceError(
        error,
        res,
        "Failed to fetch friends’ episode ratings"
      );
    }
  }
);

// ======================================================
// GET /api/tv-logs/episode/:showTmdbId/:seasonNumber/:episodeNumber/popular
//
// Most-liked public episode reviews.
// Query:
// - page=1
// - limit=20
// ======================================================

router.get(
  "/episode/:showTmdbId/:seasonNumber/:episodeNumber/popular",
  protect,
  async (req, res) => {
    try {
      const viewerUserId =
        getAuthenticatedUserId(req);

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

      const page =
        Math.max(
          1,
          Number(
            req.query.page
          ) || 1
        );

      const limit =
        Math.min(
          50,
          Math.max(
            1,
            Number(
              req.query.limit
            ) || 20
          )
        );

      if (
        !Number.isInteger(showTmdbId) ||
        showTmdbId < 1 ||
        !Number.isInteger(seasonNumber) ||
        seasonNumber < 0 ||
        !Number.isInteger(episodeNumber) ||
        episodeNumber < 1
      ) {
        return res.status(400).json({
          error:
            "Invalid show, season, or episode number",
        });
      }

      const match = {
        showTmdbId,
        seasonNumber,
        episodeNumber,

        $or: [
          {
            review: {
              $nin: [
                null,
                "",
              ],
            },
          },

          {
            gif: {
              $nin: [
                null,
                "",
              ],
            },
          },

          {
            image: {
              $nin: [
                null,
                "",
              ],
            },
          },

          {
            images: {
              $exists: true,
              $not: {
                $size: 0,
              },
            },
          },
        ],
      };

      const [
        sortedLogs,
        total,
      ] = await Promise.all([
        TVLog.aggregate([
          {
            $match:
              match,
          },

          {
            $addFields: {
              calculatedLikeCount: {
                $size: {
                  $ifNull: [
                    "$likes",
                    [],
                  ],
                },
              },
            },
          },

          {
            $sort: {
              calculatedLikeCount: -1,
              createdAt: -1,
              _id: -1,
            },
          },

          {
            $skip:
              (page - 1) *
              limit,
          },

          {
            $limit:
              limit,
          },
        ]),

        TVLog.countDocuments(
          match
        ),
      ]);

      const ids =
        sortedLogs.map(
          (log) =>
            log._id
        );

      const populatedLogs =
        await TVLog.find({
          _id: {
            $in: ids,
          },
        })
          .populate(
            "user",
            "username name avatar"
          )
          .populate(
            "replies.user",
            "username name avatar"
          )
          .lean({
            virtuals: true,
          });

      const byId =
        new Map(
          populatedLogs.map(
            (log) => [
              String(log._id),
              log,
            ]
          )
        );

      const orderedLogs =
        ids
          .map((id) =>
            byId.get(
              String(id)
            )
          )
          .filter(Boolean);

      await enrichEpisodeRepliesWithReviewerData(
        orderedLogs
      );

      return res.status(200).json({
        showTmdbId,
        seasonNumber,
        episodeNumber,

        results:
          orderedLogs.map((log) =>
            serializeEpisodeReview(
              log,
              viewerUserId
            )
          ),

        pagination: {
          page,
          limit,
          total,

          totalPages:
            Math.ceil(
              total / limit
            ),

          hasMore:
            page * limit <
            total,
        },
      });
    } catch (error) {
      return handleServiceError(
        error,
        res,
        "Failed to fetch popular episode reviews"
      );
    }
  }
);

// ======================================================
// DELETE /api/tv-logs/episode/:showTmdbId/:seasonNumber/:episodeNumber
//
// Deletes all watch history for one episode.
// ======================================================

router.delete(
  "/episode/:showTmdbId/:seasonNumber/:episodeNumber",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const showTmdbId =
        Number(
          req.params
            .showTmdbId
        );

      const seasonNumber =
        Number(
          req.params
            .seasonNumber
        );

      const episodeNumber =
        Number(
          req.params
            .episodeNumber
        );

      const logsToDelete =
        await TVLog.find({
          user:
            userId,

          showTmdbId,

          seasonNumber,

          episodeNumber,
        })
          .select("_id")
          .lean();

      const logIds =
        logsToDelete.map(
          (log) =>
            log._id
        );

      const result =
        await deleteEpisodeHistory({
          userId,
          showTmdbId,
          seasonNumber,
          episodeNumber,
        });

      if (
        logIds.length > 0
      ) {
        await Notification.deleteMany({
          tvLogId: {
            $in:
              logIds,
          },
        });
      }

      return res
        .status(200)
        .json({
          message:
            "Episode history deleted",

          deletedCount:
            result.deletedCount,

          progress:
            result.progress,
        });
    } catch (error) {
      return handleServiceError(
        error,
        res,
        "Failed to delete episode history"
      );
    }
  }
);

// ======================================================
// POST /api/tv-logs/:logId/like
//
// Toggle a like on one episode log/review.
// ======================================================

router.post(
  "/:logId/like",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      if (
        !mongoose.isValidObjectId(
          req.params.logId
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              "Invalid TV log ID",
          });
      }

      const log =
        await TVLog.findById(
          req.params.logId
        );

      if (!log) {
        return res
          .status(404)
          .json({
            error:
              "TV log not found",
          });
      }

      const alreadyLiked =
        includesObjectId(
          log.likes,
          userId
        );

      if (alreadyLiked) {
        log.likes =
          removeObjectId(
            log.likes,
            userId
          );
      } else {
        log.likes.push(
          userId
        );
      }

      await log.save();

      if (!alreadyLiked) {
        await sendNotification({
          type:
            "episode_review_like",

          fromUserId:
            userId,

          toUserId:
            log.user,

          targetType:
            "episodeReview",

          relatedId:
            String(
              log._id
            ),

          deduplicationKey:
            `episode-review-like:${log._id}:${userId}`,

          metadata: {
            action:
              "like",

            logOwnerId:
              String(
                log.user
              ),

            watchNumber:
              log.watchNumber,
          },

          ...buildEpisodeNotificationPayload(
            log
          ),
        });
      }

      return res
        .status(200)
        .json({
          liked:
            !alreadyLiked,

          likeCount:
            log.likes.length,
        });
    } catch (error) {
      return handleServiceError(
        error,
        res,
        "Failed to like episode review"
      );
    }
  }
);

// ======================================================
// POST /api/tv-logs/:logId/replies
//
// Add a top-level comment or nested reply.
// ======================================================

router.post(
  "/:logId/replies",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      if (
        !mongoose.isValidObjectId(
          req.params.logId
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              "Invalid TV log ID",
          });
      }

      const log =
        await TVLog.findById(
          req.params.logId
        );

      if (!log) {
        return res
          .status(404)
          .json({
            error:
              "TV log not found",
          });
      }

      const text =
        normalizeString(
          req.body?.text,
          5000
        );

      const gif =
        normalizeString(
          req.body?.gif,
          2000
        );

      const image =
        normalizeString(
          req.body?.image,
          2000
        );

      if (
        !text &&
        !gif &&
        !image
      ) {
        return res
          .status(400)
          .json({
            error:
              "A reply requires text, GIF, or image",
          });
      }

      let parentReply =
        null;

      let parentComment =
        null;

      if (
        req.body
          ?.parentComment
      ) {
        if (
          !mongoose.isValidObjectId(
            req.body
              .parentComment
          )
        ) {
          return res
            .status(400)
            .json({
              error:
                "Invalid parent comment ID",
            });
        }

        parentReply =
          log.replies.id(
            req.body
              .parentComment
          );

        if (!parentReply) {
          return res
            .status(404)
            .json({
              error:
                "Parent comment not found",
            });
        }

        parentComment =
          parentReply._id;
      }

      log.replies.push({
        user:
          userId,

        text,
        gif,
        image,

        likes: [],

        parentComment,
      });

      await log.save();

      const createdReply =
        log.replies[
          log.replies.length - 1
        ];

      let recipientUserId =
        log.user;

      if (
        parentReply &&
        String(
          parentReply.user
        ) !==
          String(userId)
      ) {
        recipientUserId =
          parentReply.user;
      }

      await sendNotification({
        type:
          "episode_review_comment",

        fromUserId:
          userId,

        toUserId:
          recipientUserId,

        targetType:
          "episodeReview",

        relatedId:
          String(
            createdReply._id
          ),

        metadata: {
          action:
            parentReply
              ? "nested_reply"
              : "comment",

          replyId:
            String(
              createdReply._id
            ),

          parentCommentId:
            parentComment
              ? String(
                  parentComment
                )
              : "",

          tvLogId:
            String(
              log._id
            ),
        },

        ...buildEpisodeNotificationPayload(
          log
        ),
      });

      await log.populate(
        "replies.user",
        "username name avatar"
      );

      const populatedReply =
        log.replies.id(
          createdReply._id
        );

      return res
        .status(201)
        .json({
          message:
            "Reply added",

          reply:
            serializeReply(
              populatedReply,
              userId
            ),

          replyCount:
            log.replies.length,
        });
    } catch (error) {
      return handleServiceError(
        error,
        res,
        "Failed to add episode reply"
      );
    }
  }
);

// ======================================================
// DELETE /api/tv-logs/:logId/replies/:replyId
//
// Reply author or log owner may delete.
// Direct child replies are deleted with the parent.
// ======================================================

router.delete(
  "/:logId/replies/:replyId",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      if (
        !mongoose.isValidObjectId(
          req.params.logId
        ) ||
        !mongoose.isValidObjectId(
          req.params.replyId
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              "Invalid TV log or reply ID",
          });
      }

      const log =
        await TVLog.findById(
          req.params.logId
        );

      if (!log) {
        return res
          .status(404)
          .json({
            error:
              "TV log not found",
          });
      }

      const reply =
        log.replies.id(
          req.params.replyId
        );

      if (!reply) {
        return res
          .status(404)
          .json({
            error:
              "Reply not found",
          });
      }

      const ownsReply =
        String(
          reply.user
        ) ===
        String(userId);

      const ownsLog =
        String(
          log.user
        ) ===
        String(userId);

      if (
        !ownsReply &&
        !ownsLog
      ) {
        return res
          .status(403)
          .json({
            error:
              "You cannot delete this reply",
          });
      }

      const replyId =
        String(
          reply._id
        );

      const removedReplyIds =
        log.replies
          .filter(
            (item) =>
              String(
                item._id
              ) ===
                replyId ||
              String(
                item.parentComment ||
                ""
              ) ===
                replyId
          )
          .map(
            (item) =>
              String(
                item._id
              )
          );

      log.replies =
        log.replies.filter(
          (item) =>
            !removedReplyIds.includes(
              String(
                item._id
              )
            )
        );

      await log.save();

      await Notification.deleteMany({
        tvLogId:
          log._id,

        relatedId: {
          $in:
            removedReplyIds,
        },
      });

      return res
        .status(200)
        .json({
          message:
            "Reply deleted",

          replyId,

          removedReplyIds,

          replyCount:
            log.replies.length,
        });
    } catch (error) {
      return handleServiceError(
        error,
        res,
        "Failed to delete episode reply"
      );
    }
  }
);

// ======================================================
// POST /api/tv-logs/:logId/replies/:replyId/like
//
// Toggle a like on one embedded reply.
// ======================================================

router.post(
  "/:logId/replies/:replyId/like",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      if (
        !mongoose.isValidObjectId(
          req.params.logId
        ) ||
        !mongoose.isValidObjectId(
          req.params.replyId
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              "Invalid TV log or reply ID",
          });
      }

      const log =
        await TVLog.findById(
          req.params.logId
        );

      if (!log) {
        return res
          .status(404)
          .json({
            error:
              "TV log not found",
          });
      }

      const reply =
        log.replies.id(
          req.params.replyId
        );

      if (!reply) {
        return res
          .status(404)
          .json({
            error:
              "Reply not found",
          });
      }

      const alreadyLiked =
        includesObjectId(
          reply.likes,
          userId
        );

      if (alreadyLiked) {
        reply.likes =
          removeObjectId(
            reply.likes,
            userId
          );
      } else {
        reply.likes.push(
          userId
        );
      }

      await log.save();

      if (!alreadyLiked) {
        await sendNotification({
          type:
            "reaction",

          fromUserId:
            userId,

          toUserId:
            reply.user,

          targetType:
            "episodeReview",

          relatedId:
            String(
              reply._id
            ),

          deduplicationKey:
            `episode-reply-like:${log._id}:${reply._id}:${userId}`,

          metadata: {
            action:
              "reply_like",

            replyId:
              String(
                reply._id
              ),

            tvLogId:
              String(
                log._id
              ),
          },

          ...buildEpisodeNotificationPayload(
            log
          ),
        });
      }

      return res
        .status(200)
        .json({
          liked:
            !alreadyLiked,

          likeCount:
            reply.likes.length,
        });
    } catch (error) {
      return handleServiceError(
        error,
        res,
        "Failed to like episode reply"
      );
    }
  }
);

// ======================================================
// GET /api/tv-logs/:logId
//
// Public episode review/log page.
// ======================================================

router.get(
  "/:logId",
  async (req, res) => {
    try {
      const log =
        await getEpisodeLogById({
          logId:
            req.params.logId,
        });

      await enrichEpisodeRepliesWithReviewerData(
        log
      );

      return res
        .status(200)
        .json({
          log:
            serializeEpisodeReview(
              log,
              getAuthenticatedUserId(
                req
              )
            ),
        });
    } catch (error) {
      return handleServiceError(
        error,
        res,
        "Failed to fetch TV log"
      );
    }
  }
);

// ======================================================
// PATCH /api/tv-logs/:logId
//
// Edit rating, review, media, date, character, or backdrop.
// ======================================================

router.patch(
  "/:logId",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const allowedFields = [
        "rating",
        "review",
        "containsSpoilers",
        "watchedAt",
        "customEpisodeBackdrop",
        "customShowPoster",
        "gif",
        "image",
        "images",
        "favoriteCharacter",
      ];

      const updates = {};

      for (
        const field of
          allowedFields
      ) {
        if (
          Object.prototype
            .hasOwnProperty
            .call(
              req.body,
              field
            )
        ) {
          updates[field] =
            req.body[field];
        }
      }

      const result =
        await updateEpisodeLog({
          userId,

          logId:
            req.params.logId,

          updates,
        });

      return res
        .status(200)
        .json({
          message:
            "TV log updated",

          log:
            result.log,

          progress:
            result.progress,
        });
    } catch (error) {
      return handleServiceError(
        error,
        res,
        "Failed to update TV log"
      );
    }
  }
);

// ======================================================
// DELETE /api/tv-logs/:logId
//
// Deletes one exact watch.
// Remaining history is renumbered.
// ======================================================

router.delete(
  "/:logId",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      if (
        !mongoose.isValidObjectId(
          req.params.logId
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              "Invalid TV log ID",
          });
      }

      const result =
        await deleteEpisodeLog({
          userId,

          logId:
            req.params.logId,
        });

      await Notification.deleteMany({
        tvLogId:
          req.params.logId,
      });

      return res
        .status(200)
        .json({
          message:
            "TV log deleted",

          deletedLogId:
            result.deletedLogId,

          remainingWatchCount:
            result.remainingWatchCount,

          progress:
            result.progress,
        });
    } catch (error) {
      return handleServiceError(
        error,
        res,
        "Failed to delete TV log"
      );
    }
  }
);

// ======================================================
// Export
// ======================================================

module.exports =
  router;

  