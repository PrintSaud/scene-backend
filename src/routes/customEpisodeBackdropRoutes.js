// src/routes/customEpisodeBackdropRoutes.js

const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const protect = require(
  "../middleware/authMiddleware"
);

const CustomEpisodeBackdrop = require(
  "../models/customEpisodeBackdrop"
);

const Show = require(
  "../models/showModel"
);

const Episode = require(
  "../models/episodeModel"
);

const User = require(
  "../models/user"
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

function parseSeasonNumber(value) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 0
  ) {
    const error = new Error(
      "Invalid season number"
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

function escapeRegex(value) {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function serializeBackdrop(
  backdrop
) {
  const populatedUser =
    backdrop.userId &&
    typeof backdrop.userId ===
      "object" &&
    backdrop.userId._id
      ? backdrop.userId
      : null;

  return {
    id:
      String(backdrop._id),

    user: {
      id: populatedUser
        ? String(
            populatedUser._id
          )
        : String(
            backdrop.userId
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
      id: backdrop.show
        ? String(
            backdrop.show
          )
        : null,

      tmdbId:
        Number(
          backdrop.showId
        ),
    },

    episode: {
      id: backdrop.episode
        ? String(
            backdrop.episode
          )
        : null,

      tmdbId:
        backdrop.episodeId ??
        null,

      seasonNumber:
        backdrop.seasonNumber,

      episodeNumber:
        backdrop.episodeNumber,

      code:
        `S${backdrop.seasonNumber}E${backdrop.episodeNumber}`,
    },

    backdropUrl:
      backdrop.backdropUrl ||
      "",

    createdAt:
      backdrop.createdAt ||
      null,

    updatedAt:
      backdrop.updatedAt ||
      null,
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

  if (
    error?.code === 11000
  ) {
    return res.status(409).json({
      error:
        "A custom backdrop already exists for this user and episode",
    });
  }

  const statusCode =
    Number(
      error?.statusCode
    ) || 500;

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
// GET current user's backdrop for one episode
//
// GET /api/custom-episode-backdrops/show/:showTmdbId/season/:seasonNumber/episode/:episodeNumber/me
// ======================================================

router.get(
  "/show/:showTmdbId/season/:seasonNumber/episode/:episodeNumber/me",
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

      const seasonNumber =
        parseSeasonNumber(
          req.params.seasonNumber
        );

      const episodeNumber =
        parsePositiveInteger(
          req.params.episodeNumber,
          "episode number"
        );

      const backdrop =
        await CustomEpisodeBackdrop.findOne({
          userId,

          showId:
            showTmdbId,

          seasonNumber,

          episodeNumber,
        })
          .populate(
            "userId",
            "username name avatar"
          )
          .lean({
            virtuals: true,
          });

      return res.status(200).json({
        showTmdbId,
        seasonNumber,
        episodeNumber,

        hasCustomBackdrop:
          Boolean(backdrop),

        backdrop:
          backdrop
            ? serializeBackdrop(
                backdrop
              )
            : null,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch custom episode backdrop"
      );
    }
  }
);

// ======================================================
// GET recent selections for one episode
// ======================================================

router.get(
  "/show/:showTmdbId/season/:seasonNumber/episode/:episodeNumber",
  async (req, res) => {
    try {
      const showTmdbId =
        parsePositiveInteger(
          req.params.showTmdbId,
          "show ID"
        );

      const seasonNumber =
        parseSeasonNumber(
          req.params.seasonNumber
        );

      const episodeNumber =
        parsePositiveInteger(
          req.params.episodeNumber,
          "episode number"
        );

      const limit =
        parseLimit(
          req.query.limit,
          50
        );

      const backdrops =
        await CustomEpisodeBackdrop.find({
          showId:
            showTmdbId,

          seasonNumber,

          episodeNumber,
        })
          .sort({
            updatedAt: -1,
          })
          .limit(limit)
          .populate(
            "userId",
            "username name avatar"
          )
          .lean({
            virtuals: true,
          });

      return res.status(200).json({
        showTmdbId,
        seasonNumber,
        episodeNumber,

        results:
          backdrops.map(
            serializeBackdrop
          ),

        count:
          backdrops.length,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch episode backdrop selections"
      );
    }
  }
);

// ======================================================
// GET most-used backdrop URLs for one episode
// ======================================================

router.get(
  "/show/:showTmdbId/season/:seasonNumber/episode/:episodeNumber/popular",
  async (req, res) => {
    try {
      const showTmdbId =
        parsePositiveInteger(
          req.params.showTmdbId,
          "show ID"
        );

      const seasonNumber =
        parseSeasonNumber(
          req.params.seasonNumber
        );

      const episodeNumber =
        parsePositiveInteger(
          req.params.episodeNumber,
          "episode number"
        );

      const limit =
        parseLimit(
          req.query.limit,
          20
        );

      const [
        results,
        totalSelections,
      ] = await Promise.all([
        CustomEpisodeBackdrop.aggregate([
          {
            $match: {
              showId:
                showTmdbId,

              seasonNumber,

              episodeNumber,
            },
          },

          {
            $group: {
              _id:
                "$backdropUrl",

              selectionCount: {
                $sum: 1,
              },

              latestSelectionAt: {
                $max:
                  "$updatedAt",
              },
            },
          },

          {
            $sort: {
              selectionCount: -1,
              latestSelectionAt: -1,
            },
          },

          {
            $limit:
              limit,
          },

          {
            $project: {
              _id: 0,

              backdropUrl:
                "$_id",

              selectionCount: 1,
              latestSelectionAt: 1,
            },
          },
        ]),

        CustomEpisodeBackdrop.countDocuments({
          showId:
            showTmdbId,

          seasonNumber,

          episodeNumber,
        }),
      ]);

      return res.status(200).json({
        showTmdbId,
        seasonNumber,
        episodeNumber,

        totalSelections,

        results:
          results.map(
            (item) => ({
              backdropUrl:
                item.backdropUrl,

              selectionCount:
                item.selectionCount,

              percentage:
                totalSelections > 0
                  ? Math.round(
                      (
                        item.selectionCount /
                        totalSelections
                      ) * 100
                    )
                  : 0,

              latestSelectionAt:
                item.latestSelectionAt ||
                null,
            })
          ),
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch popular episode backdrops"
      );
    }
  }
);

// ======================================================
// GET all custom backdrops for one season
// ======================================================

router.get(
  "/show/:showTmdbId/season/:seasonNumber/me",
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

      const seasonNumber =
        parseSeasonNumber(
          req.params.seasonNumber
        );

      const backdrops =
        await CustomEpisodeBackdrop.find({
          userId,

          showId:
            showTmdbId,

          seasonNumber,
        })
          .sort({
            episodeNumber: 1,
          })
          .populate(
            "userId",
            "username name avatar"
          )
          .lean({
            virtuals: true,
          });

      return res.status(200).json({
        showTmdbId,
        seasonNumber,

        results:
          backdrops.map(
            serializeBackdrop
          ),

        count:
          backdrops.length,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch season custom backdrops"
      );
    }
  }
);

// ======================================================
// POST create or replace current user's backdrop
//
// POST /api/custom-episode-backdrops
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
          req.body?.showId,
          "show ID"
        );

      const seasonNumber =
        parseSeasonNumber(
          req.body?.seasonNumber
        );

      const episodeNumber =
        parsePositiveInteger(
          req.body?.episodeNumber,
          "episode number"
        );

      const backdropUrl =
        normalizeString(
          req.body?.backdropUrl,
          2000
        );

      if (!backdropUrl) {
        return res.status(400).json({
          error:
            "Backdrop URL is required",
        });
      }

      const [
        localShow,
        localEpisode,
      ] = await Promise.all([
        Show.findOne({
          tmdbId:
            showTmdbId,
        })
          .select("_id tmdbId")
          .lean(),

        Episode.findOne({
          showTmdbId,
          seasonNumber,
          episodeNumber,
        })
          .select(
            "_id tmdbId seasonNumber episodeNumber"
          )
          .lean(),
      ]);

      if (!localShow) {
        return res.status(404).json({
          error:
            "Show metadata not found. Open the show page before selecting a backdrop.",
        });
      }

      if (!localEpisode) {
        return res.status(404).json({
          error:
            "Episode metadata not found. Open the episode page before selecting a backdrop.",
        });
      }

      const episodeTmdbId =
        Number.isInteger(
          Number(
            localEpisode.tmdbId
          )
        )
          ? Number(
              localEpisode.tmdbId
            )
          : null;

      const existing =
        await CustomEpisodeBackdrop.findOne({
          userId,

          showId:
            showTmdbId,

          seasonNumber,

          episodeNumber,
        });

      let backdrop;
      let created;

      if (existing) {
        existing.show =
          localShow._id;

        existing.episode =
          localEpisode._id;

        existing.episodeId =
          episodeTmdbId;

        existing.backdropUrl =
          backdropUrl;

        await existing.save();

        backdrop =
          existing;

        created = false;
      } else {
        backdrop =
          await CustomEpisodeBackdrop.create({
            userId,

            show:
              localShow._id,

            episode:
              localEpisode._id,

            showId:
              showTmdbId,

            episodeId:
              episodeTmdbId,

            seasonNumber,

            episodeNumber,

            backdropUrl,
          });

        created = true;
      }

      await backdrop.populate(
        "userId",
        "username name avatar"
      );

      return res
        .status(
          created
            ? 201
            : 200
        )
        .json({
          message:
            created
              ? "Custom episode backdrop selected"
              : "Custom episode backdrop updated",

          created,

          backdrop:
            serializeBackdrop(
              backdrop.toObject({
                virtuals: true,
              })
            ),
        });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to save custom episode backdrop"
      );
    }
  }
);

// ======================================================
// PATCH update current user's backdrop
// ======================================================

router.patch(
  "/show/:showTmdbId/season/:seasonNumber/episode/:episodeNumber",
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

      const seasonNumber =
        parseSeasonNumber(
          req.params.seasonNumber
        );

      const episodeNumber =
        parsePositiveInteger(
          req.params.episodeNumber,
          "episode number"
        );

      const backdropUrl =
        normalizeString(
          req.body?.backdropUrl,
          2000
        );

      if (!backdropUrl) {
        return res.status(400).json({
          error:
            "Backdrop URL is required",
        });
      }

      const backdrop =
        await CustomEpisodeBackdrop.findOne({
          userId,

          showId:
            showTmdbId,

          seasonNumber,

          episodeNumber,
        });

      if (!backdrop) {
        return res.status(404).json({
          error:
            "Custom episode backdrop not found",
        });
      }

      backdrop.backdropUrl =
        backdropUrl;

      await backdrop.save();

      await backdrop.populate(
        "userId",
        "username name avatar"
      );

      return res.status(200).json({
        message:
          "Custom episode backdrop updated",

        backdrop:
          serializeBackdrop(
            backdrop.toObject({
              virtuals: true,
            })
          ),
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to update custom episode backdrop"
      );
    }
  }
);

// ======================================================
// DELETE current user's backdrop
// ======================================================

router.delete(
  "/show/:showTmdbId/season/:seasonNumber/episode/:episodeNumber",
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

      const seasonNumber =
        parseSeasonNumber(
          req.params.seasonNumber
        );

      const episodeNumber =
        parsePositiveInteger(
          req.params.episodeNumber,
          "episode number"
        );

      const result =
        await CustomEpisodeBackdrop.deleteOne({
          userId,

          showId:
            showTmdbId,

          seasonNumber,

          episodeNumber,
        });

      const removed =
        result.deletedCount > 0;

      return res.status(200).json({
        message:
          removed
            ? "Custom episode backdrop removed"
            : "No custom episode backdrop existed",

        removed,

        showTmdbId,
        seasonNumber,
        episodeNumber,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to remove custom episode backdrop"
      );
    }
  }
);

// ======================================================
// GET public backdrop selections made by one user
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

      const limit =
        parseLimit(
          req.query.limit,
          100
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
            "_id username"
          )
          .lean();

      if (!user) {
        return res.status(404).json({
          error:
            "User not found",
        });
      }

      const backdrops =
        await CustomEpisodeBackdrop.find({
          userId:
            user._id,
        })
          .sort({
            updatedAt: -1,
          })
          .limit(limit)
          .populate(
            "userId",
            "username name avatar"
          )
          .lean({
            virtuals: true,
          });

      return res.status(200).json({
        username:
          user.username,

        results:
          backdrops.map(
            serializeBackdrop
          ),

        count:
          backdrops.length,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch user custom episode backdrops"
      );
    }
  }
);

// ======================================================
// Export
// ======================================================

module.exports = router;