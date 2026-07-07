// src/routes/showFavoriteCharacterRoutes.js

const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const protect = require(
  "../middleware/authMiddleware"
);

const ShowFavoriteCharacter = require(
    "../models/showFavouriteCharacter"
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

const DEFAULT_LIMIT = 20;
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

function getTeamTag(character) {
  const name =
    character?.characterName;

  if (
    typeof name !== "string" ||
    !name.trim()
  ) {
    return null;
  }

  const normalized =
    name
      .trim()
      .replace(/\s+/g, "");

  return normalized
    ? `#Team${normalized}`
    : null;
}

function normalizeCharacter(value) {
  if (
    !value ||
    typeof value !== "object"
  ) {
    const error = new Error(
      "Favorite character is required"
    );

    error.statusCode = 400;

    throw error;
  }

  const actorId =
    parsePositiveInteger(
      value.actorId,
      "actor ID"
    );

  const characterName =
    normalizeString(
      value.characterName,
      500
    );

  if (!characterName) {
    const error = new Error(
      "Character name is required"
    );

    error.statusCode = 400;

    throw error;
  }

  return {
    actorId,

    creditId:
      normalizeString(
        value.creditId,
        500
      ),

    characterName,

    actorName:
      normalizeString(
        value.actorName,
        500
      ),

    profilePath:
      normalizeString(
        value.profilePath,
        2000
      ),
  };
}

function serializeSelection(
  selection
) {
  const populatedUser =
    selection.user &&
    typeof selection.user ===
      "object" &&
    selection.user._id
      ? selection.user
      : null;

  return {
    id:
      String(selection._id),

    user: {
      id: populatedUser
        ? String(
            populatedUser._id
          )
        : String(
            selection.user
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
      id: selection.show
        ? String(
            selection.show
          )
        : null,

      tmdbId:
        selection.showTmdbId,

      name:
        selection.showName || "",

      posterPath:
        selection.showPoster || "",

      backdropPath:
        selection.showBackdrop || "",

      firstAirDate:
        selection.firstAirDate || "",
    },

    character:
      selection.character || null,

    teamTag:
      getTeamTag(
        selection.character
      ),

    createdAt:
      selection.createdAt || null,

    updatedAt:
      selection.updatedAt || null,
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
        "A favorite character selection already exists for this show",
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
// GET /api/show-favorite-characters/show/:showTmdbId/me
//
// Current user's favorite character for one show.
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

      const selection =
        await ShowFavoriteCharacter.findOne({
          user: userId,
          showTmdbId,
        })
          .populate(
            "user",
            "username name avatar"
          )
          .lean({
            virtuals: true,
          });

      return res.status(200).json({
        showTmdbId,

        hasSelection:
          Boolean(selection),

        selection:
          selection
            ? serializeSelection(
                selection
              )
            : null,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch favorite character"
      );
    }
  }
);

// ======================================================
// GET /api/show-favorite-characters/show/:showTmdbId/popular
//
// Community favorite-character breakdown.
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

      const results =
        await ShowFavoriteCharacter.aggregate([
          {
            $match: {
              showTmdbId,
            },
          },

          {
            $group: {
              _id: {
                actorId:
                  "$character.actorId",

                creditId:
                  "$character.creditId",

                characterName:
                  "$character.characterName",

                actorName:
                  "$character.actorName",

                profilePath:
                  "$character.profilePath",
              },

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

              character: {
                actorId:
                  "$_id.actorId",

                creditId:
                  "$_id.creditId",

                characterName:
                  "$_id.characterName",

                actorName:
                  "$_id.actorName",

                profilePath:
                  "$_id.profilePath",
              },

              selectionCount: 1,
              latestSelectionAt: 1,
            },
          },
        ]);

      const totalSelections =
        await ShowFavoriteCharacter.countDocuments({
          showTmdbId,
        });

      const serialized =
        results.map(
          (item) => ({
            character:
              item.character,

            teamTag:
              getTeamTag(
                item.character
              ),

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
        );

      return res.status(200).json({
        showTmdbId,

        totalSelections,

        results:
          serialized,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch popular show characters"
      );
    }
  }
);

// ======================================================
// GET /api/show-favorite-characters/show/:showTmdbId/friends
//
// Current user's followed users' selections.
// ======================================================

router.get(
  "/show/:showTmdbId/friends",
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

      const currentUser =
        await User.findById(
          userId
        )
          .select(
            "following"
          )
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

      if (
        following.length === 0
      ) {
        return res.status(200).json({
          showTmdbId,
          results: [],
          count: 0,
        });
      }

      const selections =
        await ShowFavoriteCharacter.find({
          showTmdbId,

          user: {
            $in: following,
          },
        })
          .sort({
            updatedAt: -1,
          })
          .populate(
            "user",
            "username name avatar"
          )
          .lean({
            virtuals: true,
          });

      return res.status(200).json({
        showTmdbId,

        results:
          selections.map(
            serializeSelection
          ),

        count:
          selections.length,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch friends’ favorite characters"
      );
    }
  }
);

// ======================================================
// GET /api/show-favorite-characters/show/:showTmdbId
//
// All public selections for one show.
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
          req.query.limit
        );

      const selections =
        await ShowFavoriteCharacter.find({
          showTmdbId,
        })
          .sort({
            updatedAt: -1,
          })
          .limit(limit)
          .populate(
            "user",
            "username name avatar"
          )
          .lean({
            virtuals: true,
          });

      return res.status(200).json({
        showTmdbId,

        results:
          selections.map(
            serializeSelection
          ),

        count:
          selections.length,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch show favorite characters"
      );
    }
  }
);

// ======================================================
// POST /api/show-favorite-characters
//
// Create or replace current user's selection.
//
// Body:
// {
//   "showTmdbId": 1396,
//   "character": {
//     "actorId": 17419,
//     "creditId": "...",
//     "characterName": "Walter White",
//     "actorName": "Bryan Cranston",
//     "profilePath": "..."
//   }
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
          req.body?.showTmdbId,
          "show ID"
        );

      const character =
        normalizeCharacter(
          req.body?.character
        );

      const localShow =
        await Show.findOne({
          tmdbId:
            showTmdbId,
        });

      if (!localShow) {
        return res.status(404).json({
          error:
            "Show metadata not found. Open the show page before selecting a character.",
        });
      }

      const snapshot = {
        show:
          localShow._id,

        showTmdbId,

        showName:
          localShow.name ||
          "Untitled Show",

        showPoster:
          localShow.posterPath ||
          "",

        showBackdrop:
          localShow.backdropPath ||
          "",

        firstAirDate:
          localShow.firstAirDate
            ? new Date(
                localShow.firstAirDate
              )
                .toISOString()
                .slice(0, 10)
            : "",

        character,
      };

      const existing =
        await ShowFavoriteCharacter.findOne({
          user: userId,
          showTmdbId,
        });

      let selection;
      let created;

      if (existing) {
        existing.show =
          snapshot.show;

        existing.showName =
          snapshot.showName;

        existing.showPoster =
          snapshot.showPoster;

        existing.showBackdrop =
          snapshot.showBackdrop;

        existing.firstAirDate =
          snapshot.firstAirDate;

        existing.character =
          snapshot.character;

        await existing.save();

        selection =
          existing;

        created = false;
      } else {
        selection =
          await ShowFavoriteCharacter.create({
            user: userId,
            ...snapshot,
          });

        created = true;
      }

      await selection.populate(
        "user",
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
              ? "Favorite show character selected"
              : "Favorite show character updated",

          created,

          selection:
            serializeSelection(
              selection.toObject({
                virtuals: true,
              })
            ),
        });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to save favorite show character"
      );
    }
  }
);

// ======================================================
// PATCH /api/show-favorite-characters/show/:showTmdbId
//
// Update current user's existing selection.
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

      const character =
        normalizeCharacter(
          req.body?.character
        );

      const selection =
        await ShowFavoriteCharacter.findOne({
          user: userId,
          showTmdbId,
        });

      if (!selection) {
        return res.status(404).json({
          error:
            "Favorite character selection not found",
        });
      }

      selection.character =
        character;

      await selection.save();

      await selection.populate(
        "user",
        "username name avatar"
      );

      return res.status(200).json({
        message:
          "Favorite show character updated",

        selection:
          serializeSelection(
            selection.toObject({
              virtuals: true,
            })
          ),
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to update favorite show character"
      );
    }
  }
);

// ======================================================
// DELETE /api/show-favorite-characters/show/:showTmdbId
//
// Remove current user's selection.
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
        await ShowFavoriteCharacter.deleteOne({
          user: userId,
          showTmdbId,
        });

      const removed =
        result.deletedCount > 0;

      return res.status(200).json({
        message:
          removed
            ? "Favorite show character removed"
            : "No favorite character selection existed",

        removed,
        showTmdbId,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to remove favorite show character"
      );
    }
  }
);

// ======================================================
// GET /api/show-favorite-characters/user/:username
//
// Public profile character choices.
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
          50
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

      const selections =
        await ShowFavoriteCharacter.find({
          user: user._id,
        })
          .sort({
            updatedAt: -1,
          })
          .limit(limit)
          .populate(
            "user",
            "username name avatar"
          )
          .lean({
            virtuals: true,
          });

      return res.status(200).json({
        username:
          user.username,

        results:
          selections.map(
            serializeSelection
          ),

        count:
          selections.length,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch user character choices"
      );
    }
  }
);

// ======================================================
// Export
// ======================================================

module.exports = router;