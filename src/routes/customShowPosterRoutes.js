// src/routes/customShowPosterRoutes.js

const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const protect = require(
  "../middleware/authMiddleware"
);

const newLocal = "../models/customShowPoster";
const CustomShowPoster = require(
  newLocal
);

const Show = require(
  "../models/showModel"
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

function serializePoster(
  poster
) {
  const populatedUser =
    poster.userId &&
    typeof poster.userId ===
      "object" &&
    poster.userId._id
      ? poster.userId
      : null;

  return {
    id:
      String(poster._id),

    user: {
      id: populatedUser
        ? String(
            populatedUser._id
          )
        : String(
            poster.userId
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
      id: poster.show
        ? String(
            poster.show
          )
        : null,

      tmdbId:
        Number(
          poster.showId
        ),
    },

    posterUrl:
      poster.posterUrl || "",

    createdAt:
      poster.createdAt || null,

    updatedAt:
      poster.updatedAt || null,
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
        "A custom poster already exists for this user and show",
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
// POST /api/custom-show-posters/user/:userId/batch
//
// Public profile-owner poster lookup.
//
// Body:
// {
//   "showTmdbIds": [1396, 60059]
// }
//
// Returns the custom posters selected by the profile
// owner, so visitors see that user's profile styling.
// ======================================================

router.post(
  "/user/:userId/batch",
  async (req, res) => {
    try {
      const { userId } = req.params;

      if (
        !mongoose.isValidObjectId(
          userId
        )
      ) {
        return res.status(400).json({
          error:
            "Invalid user ID",
        });
      }

      const showTmdbIds = [
        ...new Set(
          (
            Array.isArray(
              req.body?.showTmdbIds
            )
              ? req.body.showTmdbIds
              : []
          )
            .map(Number)
            .filter(
              (value) =>
                Number.isInteger(
                  value
                ) &&
                value > 0
            )
        ),
      ].slice(
        0,
        MAXIMUM_LIMIT
      );

      if (
        showTmdbIds.length === 0
      ) {
        return res
          .status(200)
          .json({});
      }

      const userExists =
        await User.exists({
          _id:
            userId,
        });

      if (!userExists) {
        return res.status(404).json({
          error:
            "User not found",
        });
      }

      const posters =
        await CustomShowPoster.find({
          userId,

          showId: {
            $in:
              showTmdbIds,
          },
        })
          .select(
            "showId posterUrl -_id"
          )
          .lean();

      const result = {};

      for (
        const poster of posters
      ) {
        if (
          poster?.posterUrl
        ) {
          result[
            String(
              poster.showId
            )
          ] =
            poster.posterUrl;
        }
      }

      return res
        .status(200)
        .json(result);
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch profile custom show posters"
      );
    }
  }
);

// ======================================================
// POST /api/custom-show-posters/batch
//
// Returns the current user's custom poster for many shows.
//
// Body:
// {
//   "showTmdbIds": [1396, 60059]
// }
//
// Response:
// {
//   "1396": "https://...",
//   "60059": "https://..."
// }
// ======================================================

router.post(
  "/batch",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      if (
        !Array.isArray(
          req.body?.showTmdbIds
        )
      ) {
        return res.status(400).json({
          error:
            "showTmdbIds must be an array",
        });
      }

      const showTmdbIds = [
        ...new Set(
          req.body.showTmdbIds
            .map((value) =>
              Number(value)
            )
            .filter(
              (value) =>
                Number.isInteger(value) &&
                value > 0
            )
        ),
      ].slice(0, MAXIMUM_LIMIT);

      if (!showTmdbIds.length) {
        return res.status(200).json({});
      }

      const posters =
        await CustomShowPoster.find({
          userId,

          showId: {
            $in: showTmdbIds,
          },
        })
          .select(
            "showId posterUrl -_id"
          )
          .lean();

      const result = {};

      for (const poster of posters) {
        result[
          String(poster.showId)
        ] = poster.posterUrl;
      }

      return res.status(200).json(
        result
      );
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch custom show posters"
      );
    }
  }
);


// ======================================================
// GET /api/custom-show-posters/show/:showTmdbId/me
//
// Current user's selected poster for one show.
// ======================================================

router.get(
  "/show/:showTmdbId/me",
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

      const poster =
        await CustomShowPoster.findOne({
          userId,
          showId:
            showTmdbId,
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

        hasCustomPoster:
          Boolean(poster),

        poster:
          poster
            ? serializePoster(
                poster
              )
            : null,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch custom show poster"
      );
    }
  }
);

// ======================================================
// GET /api/custom-show-posters/show/:showTmdbId
//
// Recent public poster selections for one show.
// ======================================================

router.get(
  "/show/:showTmdbId",
  async (req, res) => {
    try {
      const showTmdbId =
        parsePositiveInteger(
          req.params.showTmdbId,
          "show ID"
        );

      const limit =
        parseLimit(
          req.query.limit,
          50
        );

      const posters =
        await CustomShowPoster.find({
          showId:
            showTmdbId,
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

        results:
          posters.map(
            serializePoster
          ),

        count:
          posters.length,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch show poster selections"
      );
    }
  }
);

// ======================================================
// GET /api/custom-show-posters/show/:showTmdbId/popular
//
// Most-used poster URLs for one show.
// ======================================================

router.get(
  "/show/:showTmdbId/popular",
  async (req, res) => {
    try {
      const showTmdbId =
        parsePositiveInteger(
          req.params.showTmdbId,
          "show ID"
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
        CustomShowPoster.aggregate([
          {
            $match: {
              showId:
                showTmdbId,
            },
          },

          {
            $group: {
              _id:
                "$posterUrl",

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

              posterUrl:
                "$_id",

              selectionCount: 1,
              latestSelectionAt: 1,
            },
          },
        ]),

        CustomShowPoster.countDocuments({
          showId:
            showTmdbId,
        }),
      ]);

      return res.status(200).json({
        showTmdbId,

        totalSelections,

        results:
          results.map(
            (item) => ({
              posterUrl:
                item.posterUrl,

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
        "Failed to fetch popular show posters"
      );
    }
  }
);

// ======================================================
// POST /api/custom-show-posters
//
// Create or replace current user's poster.
//
// Body:
// {
//   "showTmdbId": 1396,
//   "posterUrl": "/poster-path.jpg"
// }
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

      const posterUrl =
        normalizeString(
          req.body?.posterUrl,
          2000
        );

      if (!posterUrl) {
        return res.status(400).json({
          error:
            "Poster URL is required",
        });
      }

      const localShow =
        await Show.findOne({
          tmdbId:
            showTmdbId,
        })
          .select("_id tmdbId")
          .lean();

      if (!localShow) {
        return res.status(404).json({
          error:
            "Show metadata not found. Open the show page before selecting a poster.",
        });
      }

      const existing =
        await CustomShowPoster.findOne({
          userId,
          showId:
            showTmdbId,
        });

      let poster;
      let created;

      if (existing) {
        existing.show =
          localShow._id;

        existing.posterUrl =
          posterUrl;

        await existing.save();

        poster =
          existing;

        created = false;
      } else {
        poster =
          await CustomShowPoster.create({
            userId,

            show:
              localShow._id,

            showId:
              showTmdbId,

            posterUrl,
          });

        created = true;
      }

      await poster.populate(
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
              ? "Custom show poster selected"
              : "Custom show poster updated",

          created,

          poster:
            serializePoster(
              poster.toObject({
                virtuals: true,
              })
            ),
        });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to save custom show poster"
      );
    }
  }
);

// ======================================================
// PATCH /api/custom-show-posters/show/:showTmdbId
//
// Updates the current user's existing poster.
// ======================================================

router.patch(
  "/show/:showTmdbId",
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

      const posterUrl =
        normalizeString(
          req.body?.posterUrl,
          2000
        );

      if (!posterUrl) {
        return res.status(400).json({
          error:
            "Poster URL is required",
        });
      }

      const poster =
        await CustomShowPoster.findOne({
          userId,
          showId:
            showTmdbId,
        });

      if (!poster) {
        return res.status(404).json({
          error:
            "Custom show poster not found",
        });
      }

      poster.posterUrl =
        posterUrl;

      await poster.save();

      await poster.populate(
        "userId",
        "username name avatar"
      );

      return res.status(200).json({
        message:
          "Custom show poster updated",

        poster:
          serializePoster(
            poster.toObject({
              virtuals: true,
            })
          ),
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to update custom show poster"
      );
    }
  }
);

// ======================================================
// DELETE /api/custom-show-posters/show/:showTmdbId
//
// Removes the current user's custom poster.
// ======================================================

router.delete(
  "/show/:showTmdbId",
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

      const result =
        await CustomShowPoster.deleteOne({
          userId,
          showId:
            showTmdbId,
        });

      const removed =
        result.deletedCount > 0;

      return res.status(200).json({
        message:
          removed
            ? "Custom show poster removed"
            : "No custom show poster existed",

        removed,
        showTmdbId,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to remove custom show poster"
      );
    }
  }
);

// ======================================================
// GET /api/custom-show-posters/user/:username
//
// Public poster selections made by one user.
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

      const posters =
        await CustomShowPoster.find({
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
          posters.map(
            serializePoster
          ),

        count:
          posters.length,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch user custom show posters"
      );
    }
  }
);

// ======================================================
// Export
// ======================================================

module.exports = router;
