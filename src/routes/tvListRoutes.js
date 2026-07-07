// src/routes/tvListRoutes.js

const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const protect = require(
  "../middleware/authMiddleware"
);

const List = require(
  "../models/list"
);

const User = require(
  "../models/user"
);

const Show = require(
  "../models/showModel"
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

function parseShowTmdbId(
  value
) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 1
  ) {
    const error = new Error(
      "Invalid show ID"
    );

    error.statusCode = 400;

    throw error;
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

function normalizeBoolean(
  value,
  fallback = false
) {
  if (
    value === true ||
    value === "true" ||
    value === 1 ||
    value === "1"
  ) {
    return true;
  }

  if (
    value === false ||
    value === "false" ||
    value === 0 ||
    value === "0"
  ) {
    return false;
  }

  return fallback;
}

function escapeRegex(value) {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function userOwnsList(
  list,
  userId
) {
  return (
    String(list.user?._id || list.user) ===
    String(userId)
  );
}

function includesObjectId(
  values,
  userId
) {
  return Array.isArray(values)
    ? values.some(
        (value) =>
          String(value?._id || value) ===
          String(userId)
      )
    : false;
}

function serializeShowItem(
  show,
  index = null,
  isRanked = false
) {
  return {
    id:
      show._id
        ? String(show._id)
        : null,

    tmdbId:
      Number(show.id),

    name:
      show.name || "",

    poster:
      show.poster || "",

    firstAirDate:
      show.firstAirDate || "",

    addedAt:
      show.addedAt || null,

    rank:
      isRanked &&
      index !== null
        ? index + 1
        : null,

    navigation: {
      screen: "Show",

      params: {
        showTmdbId:
          Number(show.id),
      },
    },
  };
}

function serializeList(
  list,
  viewerUserId = null
) {
  const owner =
    list.user &&
    typeof list.user === "object"
      ? list.user
      : null;

  const shows =
    Array.isArray(list.shows)
      ? list.shows
      : [];

  return {
    id: String(list._id),

    mediaType: "tv",

    title:
      list.title || "",

    description:
      list.description || "",

    coverImage:
      list.coverImage || "",

    isPrivate:
      Boolean(
        list.isPrivate
      ),

    isRanked:
      Boolean(
        list.isRanked
      ),

    owner: {
      id: owner
        ? String(owner._id)
        : String(list.user),

      username:
        owner?.username || "",

      name:
        owner?.name || "",

      avatar:
        owner?.avatar || "",
    },

    shows:
      shows.map(
        (show, index) =>
          serializeShowItem(
            show,
            index,
            Boolean(
              list.isRanked
            )
          )
      ),

    itemCount:
      shows.length,

    engagement: {
      likeCount:
        Array.isArray(
          list.likes
        )
          ? list.likes.length
          : 0,

      saveCount:
        Array.isArray(
          list.savedBy
        )
          ? list.savedBy.length
          : 0,

      likedByViewer:
        viewerUserId
          ? includesObjectId(
              list.likes,
              viewerUserId
            )
          : false,

      savedByViewer:
        viewerUserId
          ? includesObjectId(
              list.savedBy,
              viewerUserId
            )
          : false,
    },

    permissions: {
      canEdit:
        viewerUserId
          ? userOwnsList(
              list,
              viewerUserId
            )
          : false,

      canDelete:
        viewerUserId
          ? userOwnsList(
              list,
              viewerUserId
            )
          : false,
    },

    source:
      list.source ||
      "manual",

    createdAt:
      list.createdAt || null,

    updatedAt:
      list.updatedAt || null,
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
// Optional authentication helper
//
// Public list pages still work without a token.
// If auth exists, viewer state is included.
// ======================================================

async function resolveOptionalViewer(
  req
) {
  const header =
    req.headers.authorization;

  if (
    !header ||
    !header.startsWith(
      "Bearer "
    )
  ) {
    return null;
  }

  return null;
}

// ======================================================
// GET /api/tv-lists/popular
//
// Public TV lists sorted by likes.
// ======================================================

router.get(
  "/popular",
  async (req, res) => {
    try {
      const page =
        parsePage(
          req.query.page
        );

      const limit =
        parseLimit(
          req.query.limit
        );

      const match = {
        mediaType: "tv",
        isPrivate: false,
      };

      const [
        lists,
        total,
      ] = await Promise.all([
        List.find(match)
          .sort({
            "likes.0": -1,
            createdAt: -1,
          })
          .skip(
            (page - 1) *
              limit
          )
          .limit(limit)
          .populate(
            "user",
            "username name avatar"
          )
          .lean({
            virtuals: true,
          }),

        List.countDocuments(
          match
        ),
      ]);

      lists.sort(
        (first, second) =>
          (
            second.likes?.length ||
            0
          ) -
          (
            first.likes?.length ||
            0
          ) ||
          new Date(
            second.createdAt
          ).getTime() -
          new Date(
            first.createdAt
          ).getTime()
      );

      return res.status(200).json({
        results:
          lists.map((list) =>
            serializeList(list)
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
      return handleError(
        error,
        res,
        "Failed to fetch popular TV lists"
      );
    }
  }
);

// ======================================================
// GET /api/tv-lists/friends
//
// Public lists created by people the current user follows.
// ======================================================

router.get(
  "/friends",
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

      const match = {
        mediaType: "tv",
        isPrivate: false,

        user: {
          $in: following,
        },
      };

      const [
        lists,
        total,
      ] = await Promise.all([
        List.find(match)
          .sort({
            createdAt: -1,
          })
          .skip(
            (page - 1) *
              limit
          )
          .limit(limit)
          .populate(
            "user",
            "username name avatar"
          )
          .lean({
            virtuals: true,
          }),

        List.countDocuments(
          match
        ),
      ]);

      return res.status(200).json({
        results:
          lists.map((list) =>
            serializeList(
              list,
              userId
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
      return handleError(
        error,
        res,
        "Failed to fetch friends’ TV lists"
      );
    }
  }
);

// ======================================================
// GET /api/tv-lists/my
//
// Current user's own TV lists.
// Private lists are included.
// ======================================================

router.get(
  "/my",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const lists =
        await List.find({
          user: userId,
          mediaType: "tv",
        })
          .sort({
            createdAt: -1,
          })
          .populate(
            "user",
            "username name avatar"
          )
          .lean({
            virtuals: true,
          });

      return res.status(200).json({
        results:
          lists.map((list) =>
            serializeList(
              list,
              userId
            )
          ),

        count:
          lists.length,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch your TV lists"
      );
    }
  }
);

// ======================================================
// GET /api/tv-lists/saved
//
// TV lists saved by the current user.
// ======================================================

router.get(
  "/saved",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const lists =
        await List.find({
          mediaType: "tv",
          isPrivate: false,
          savedBy: userId,
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
        results:
          lists.map((list) =>
            serializeList(
              list,
              userId
            )
          ),

        count:
          lists.length,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch saved TV lists"
      );
    }
  }
);

// ======================================================
// GET /api/tv-lists/user/:username
//
// Public TV lists for a profile.
// Owners can see their own private lists only through /my.
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

      const lists =
        await List.find({
          user: user._id,
          mediaType: "tv",
          isPrivate: false,
        })
          .sort({
            createdAt: -1,
          })
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
          lists.map((list) =>
            serializeList(list)
          ),

        count:
          lists.length,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch user TV lists"
      );
    }
  }
);

// ======================================================
// POST /api/tv-lists
//
// Create a TV list.
// ======================================================

router.post(
  "/",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const title =
        normalizeString(
          req.body?.title,
          300
        );

      if (!title) {
        return res.status(400).json({
          error:
            "List title is required",
        });
      }

      const inputShows =
        Array.isArray(
          req.body?.shows
        )
          ? req.body.shows
          : [];

      const seen = new Set();

      const shows =
        inputShows
          .map((show) => {
            const tmdbId =
              Number(
                show?.id ??
                show?.tmdbId
              );

            if (
              !Number.isInteger(
                tmdbId
              ) ||
              tmdbId < 1 ||
              seen.has(tmdbId)
            ) {
              return null;
            }

            seen.add(tmdbId);

            return {
              id: tmdbId,

              name:
                normalizeString(
                  show?.name,
                  500
                ),

              poster:
                normalizeString(
                  show?.poster ??
                  show?.posterPath,
                  2000
                ),

              firstAirDate:
                normalizeString(
                  show?.firstAirDate,
                  100
                ),

              addedAt:
                new Date(),
            };
          })
          .filter(Boolean);

      const list =
        await List.create({
          user: userId,

          mediaType: "tv",

          title,

          description:
            normalizeString(
              req.body?.description,
              5000
            ),

          coverImage:
            normalizeString(
              req.body?.coverImage,
              2000
            ),

          isPrivate:
            normalizeBoolean(
              req.body?.isPrivate,
              false
            ),

          isRanked:
            normalizeBoolean(
              req.body?.isRanked,
              false
            ),

          movies: [],
          shows,

          likes: [],
          savedBy: [],

          source: "manual",
        });

      await list.populate(
        "user",
        "username name avatar"
      );

      return res.status(201).json({
        message:
          "TV list created",

        list:
          serializeList(
            list.toObject({
              virtuals: true,
            }),
            userId
          ),
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to create TV list"
      );
    }
  }
);

// ======================================================
// GET /api/tv-lists/:listId
//
// Public unless private.
// ======================================================

router.get(
  "/:listId",
  async (req, res) => {
    try {
      if (
        !mongoose.isValidObjectId(
          req.params.listId
        )
      ) {
        return res.status(400).json({
          error:
            "Invalid list ID",
        });
      }

      const list =
        await List.findOne({
          _id:
            req.params.listId,

          mediaType: "tv",
        })
          .populate(
            "user",
            "username name avatar"
          )
          .lean({
            virtuals: true,
          });

      if (!list) {
        return res.status(404).json({
          error:
            "TV list not found",
        });
      }

      if (list.isPrivate) {
        return res.status(403).json({
          error:
            "This TV list is private",
        });
      }

      return res.status(200).json({
        list:
          serializeList(list),
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch TV list"
      );
    }
  }
);

// ======================================================
// PATCH /api/tv-lists/:listId
//
// Update list metadata.
// Owner only.
// ======================================================

router.patch(
  "/:listId",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      if (
        !mongoose.isValidObjectId(
          req.params.listId
        )
      ) {
        return res.status(400).json({
          error:
            "Invalid list ID",
        });
      }

      const list =
        await List.findOne({
          _id:
            req.params.listId,

          mediaType: "tv",
        });

      if (!list) {
        return res.status(404).json({
          error:
            "TV list not found",
        });
      }

      if (
        !userOwnsList(
          list,
          userId
        )
      ) {
        return res.status(403).json({
          error:
            "You cannot edit this TV list",
        });
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "title"
        )
      ) {
        const title =
          normalizeString(
            req.body.title,
            300
          );

        if (!title) {
          return res.status(400).json({
            error:
              "List title cannot be empty",
          });
        }

        list.title = title;
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "description"
        )
      ) {
        list.description =
          normalizeString(
            req.body.description,
            5000
          );
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "coverImage"
        )
      ) {
        list.coverImage =
          normalizeString(
            req.body.coverImage,
            2000
          );
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "isPrivate"
        )
      ) {
        list.isPrivate =
          normalizeBoolean(
            req.body.isPrivate,
            list.isPrivate
          );
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "isRanked"
        )
      ) {
        list.isRanked =
          normalizeBoolean(
            req.body.isRanked,
            list.isRanked
          );
      }

      await list.save();

      await list.populate(
        "user",
        "username name avatar"
      );

      return res.status(200).json({
        message:
          "TV list updated",

        list:
          serializeList(
            list.toObject({
              virtuals: true,
            }),
            userId
          ),
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to update TV list"
      );
    }
  }
);

// ======================================================
// DELETE /api/tv-lists/:listId
//
// Owner only.
// ======================================================

router.delete(
  "/:listId",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const list =
        await List.findOne({
          _id:
            req.params.listId,

          mediaType: "tv",
        });

      if (!list) {
        return res.status(404).json({
          error:
            "TV list not found",
        });
      }

      if (
        !userOwnsList(
          list,
          userId
        )
      ) {
        return res.status(403).json({
          error:
            "You cannot delete this TV list",
        });
      }

      await list.deleteOne();

      return res.status(200).json({
        message:
          "TV list deleted",

        listId:
          req.params.listId,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to delete TV list"
      );
    }
  }
);

// ======================================================
// POST /api/tv-lists/:listId/shows
//
// Add a show.
// Owner only.
// ======================================================

router.post(
  "/:listId/shows",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const list =
        await List.findOne({
          _id:
            req.params.listId,

          mediaType: "tv",
        });

      if (!list) {
        return res.status(404).json({
          error:
            "TV list not found",
        });
      }

      if (
        !userOwnsList(
          list,
          userId
        )
      ) {
        return res.status(403).json({
          error:
            "You cannot edit this TV list",
        });
      }

      const showTmdbId =
        parseShowTmdbId(
          req.body?.showTmdbId ??
          req.body?.tmdbId ??
          req.body?.id
        );

      const existing =
        list.shows.some(
          (show) =>
            Number(show.id) ===
            showTmdbId
        );

      if (existing) {
        return res.status(200).json({
          message:
            "Show is already in this TV list",

          added: false,
        });
      }

      const localShow =
        await Show.findOne({
          tmdbId:
            showTmdbId,
        }).lean();

      const name =
        normalizeString(
          req.body?.name,
          500
        ) ||
        normalizeString(
          localShow?.name,
          500
        );

      if (!name) {
        return res.status(404).json({
          error:
            "Show metadata not found",
        });
      }

      list.shows.push({
        id:
          showTmdbId,

        name,

        poster:
          normalizeString(
            req.body?.poster ??
            req.body?.posterPath,
            2000
          ) ||
          normalizeString(
            localShow?.posterPath,
            2000
          ),

        firstAirDate:
          normalizeString(
            req.body?.firstAirDate,
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

        addedAt:
          new Date(),
      });

      await list.save();

      return res.status(201).json({
        message:
          "Show added to TV list",

        added: true,

        shows:
          list.shows.map(
            (show, index) =>
              serializeShowItem(
                show,
                index,
                list.isRanked
              )
          ),
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to add show to TV list"
      );
    }
  }
);

// ======================================================
// DELETE /api/tv-lists/:listId/shows/:showTmdbId
//
// Remove a show.
// Owner only.
// ======================================================

router.delete(
  "/:listId/shows/:showTmdbId",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const showTmdbId =
        parseShowTmdbId(
          req.params.showTmdbId
        );

      const list =
        await List.findOne({
          _id:
            req.params.listId,

          mediaType: "tv",
        });

      if (!list) {
        return res.status(404).json({
          error:
            "TV list not found",
        });
      }

      if (
        !userOwnsList(
          list,
          userId
        )
      ) {
        return res.status(403).json({
          error:
            "You cannot edit this TV list",
        });
      }

      const previousCount =
        list.shows.length;

      list.shows =
        list.shows.filter(
          (show) =>
            Number(show.id) !==
            showTmdbId
        );

      const removed =
        list.shows.length <
        previousCount;

      if (removed) {
        await list.save();
      }

      return res.status(200).json({
        message:
          removed
            ? "Show removed from TV list"
            : "Show was not in this TV list",

        removed,

        shows:
          list.shows.map(
            (show, index) =>
              serializeShowItem(
                show,
                index,
                list.isRanked
              )
          ),
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to remove show from TV list"
      );
    }
  }
);

// ======================================================
// PATCH /api/tv-lists/:listId/reorder
//
// Reorder the show array.
// This is the ranking source of truth.
// Owner only.
//
// Body:
// {
//   "showTmdbIds": [1396, 1399, 66732]
// }
// ======================================================

router.patch(
  "/:listId/reorder",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const list =
        await List.findOne({
          _id:
            req.params.listId,

          mediaType: "tv",
        });

      if (!list) {
        return res.status(404).json({
          error:
            "TV list not found",
        });
      }

      if (
        !userOwnsList(
          list,
          userId
        )
      ) {
        return res.status(403).json({
          error:
            "You cannot reorder this TV list",
        });
      }

      const showTmdbIds =
        Array.isArray(
          req.body?.showTmdbIds
        )
          ? req.body.showTmdbIds.map(
              Number
            )
          : [];

      if (
        showTmdbIds.length !==
        list.shows.length
      ) {
        return res.status(400).json({
          error:
            "Reorder payload must contain every show exactly once",
        });
      }

      const existingIds =
        list.shows.map(
          (show) =>
            Number(show.id)
        );

      const uniqueIds =
        new Set(
          showTmdbIds
        );

      const valid =
        uniqueIds.size ===
          existingIds.length &&
        existingIds.every(
          (id) =>
            uniqueIds.has(id)
        );

      if (!valid) {
        return res.status(400).json({
          error:
            "Reorder payload does not match the list’s shows",
        });
      }

      const showMap =
        new Map(
          list.shows.map(
            (show) => [
              Number(show.id),
              show,
            ]
          )
        );

      list.shows =
        showTmdbIds.map(
          (id) =>
            showMap.get(id)
        );

      await list.save();

      return res.status(200).json({
        message:
          "TV list reordered",

        shows:
          list.shows.map(
            (show, index) =>
              serializeShowItem(
                show,
                index,
                list.isRanked
              )
          ),
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to reorder TV list"
      );
    }
  }
);

// ======================================================
// POST /api/tv-lists/:listId/like
//
// Toggle like.
// ======================================================

router.post(
  "/:listId/like",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const list =
        await List.findOne({
          _id:
            req.params.listId,

          mediaType: "tv",
          isPrivate: false,
        });

      if (!list) {
        return res.status(404).json({
          error:
            "TV list not found",
        });
      }

      const liked =
        includesObjectId(
          list.likes,
          userId
        );

      if (liked) {
        list.likes =
          list.likes.filter(
            (value) =>
              String(value) !==
              String(userId)
          );
      } else {
        list.likes.push(
          userId
        );
      }

      await list.save();

      return res.status(200).json({
        liked:
          !liked,

        likeCount:
          list.likes.length,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to like TV list"
      );
    }
  }
);

// ======================================================
// POST /api/tv-lists/:listId/save
//
// Toggle save.
// ======================================================

router.post(
  "/:listId/save",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const list =
        await List.findOne({
          _id:
            req.params.listId,

          mediaType: "tv",
          isPrivate: false,
        });

      if (!list) {
        return res.status(404).json({
          error:
            "TV list not found",
        });
      }

      const saved =
        includesObjectId(
          list.savedBy,
          userId
        );

      if (saved) {
        list.savedBy =
          list.savedBy.filter(
            (value) =>
              String(value) !==
              String(userId)
          );
      } else {
        list.savedBy.push(
          userId
        );
      }

      await list.save();

      return res.status(200).json({
        saved:
          !saved,

        saveCount:
          list.savedBy.length,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to save TV list"
      );
    }
  }
);

// ======================================================
// Export
// ======================================================

module.exports = router;