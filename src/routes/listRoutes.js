const express = require("express");
const mongoose = require("mongoose");
const axios = require("axios");

const router = express.Router();

const protect = require("../middleware/authMiddleware");
const protectOptional = require("../middleware/protectOptional");

const List = require("../models/list");
const User = require("../models/user");
const Movie = require("../models/movieModel");
const CustomPoster = require("../models/customPoster");
const Notification = require("../models/notification");

const TMDB_IMG = "https://image.tmdb.org/t/p/w500";
const TMDB_API_KEY = process.env.TMDB_API_KEY;

const DEFAULT_POSTER = "/default-poster.jpg";
const MAX_LIST_MOVIES = 500;
const MAX_SHARE_RECIPIENTS = 25;

// ============================================================
// HELPERS
// ============================================================

const isValidObjectId = (value) =>
  mongoose.Types.ObjectId.isValid(value);

const cleanString = (
  value,
  maximumLength = 5000
) => {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  return String(value)
    .trim()
    .slice(0, maximumLength);
};

const parseBooleanValue = (
  value,
  fallback = false
) => {
  if (value === undefined) {
    return fallback;
  }

  return value === true || value === "true";
};

const parsePagination = (
  query,
  defaultLimit = 50,
  maximumLimit = 100
) => {
  const requestedPage = Number(query.page);
  const requestedLimit = Number(query.limit);

  const page =
    Number.isInteger(requestedPage) &&
    requestedPage > 0
      ? requestedPage
      : 1;

  const limit =
    Number.isInteger(requestedLimit) &&
    requestedLimit > 0
      ? Math.min(
          requestedLimit,
          maximumLimit
        )
      : defaultLimit;

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
};

const escapeRegex = (value) =>
  String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );

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

const buildPosterUrl = (value) => {
  if (!value) return null;

  const poster = String(value).trim();

  if (!poster) return null;

  if (
    poster.startsWith("http://") ||
    poster.startsWith("https://")
  ) {
    return poster;
  }

  if (poster.startsWith("/")) {
    return `${TMDB_IMG}${poster}`;
  }

  return poster;
};

const cleanMovie = (movie) => {
  if (!movie || typeof movie !== "object") {
    return null;
  }

  const id = parseMovieId(
    movie.id ||
      movie.tmdbId ||
      movie.movieId
  );

  if (!id) return null;

  const title = cleanString(
    movie.title ||
      movie.name,
    500
  );

  if (!title) return null;

  return {
    id,
    title,
    poster: cleanString(
      movie.poster ||
        movie.posterPath ||
        movie.poster_path,
      2000
    ),
  };
};

const cleanMovies = (movies) => {
  if (!Array.isArray(movies)) {
    return [];
  }

  const seen = new Set();
  const cleaned = [];

  for (const rawMovie of movies) {
    const movie = cleanMovie(rawMovie);

    if (!movie || seen.has(movie.id)) {
      continue;
    }

    seen.add(movie.id);
    cleaned.push(movie);

    if (cleaned.length >= MAX_LIST_MOVIES) {
      break;
    }
  }

  return cleaned;
};

const canViewList = (list, viewerId) => {
  if (!list.isPrivate) return true;
  if (!viewerId) return false;

  const ownerId =
    list.user?._id || list.user;

  return (
    String(ownerId) ===
    String(viewerId)
  );
};

async function getMovieMetadataMap(
  movieIds
) {
  const uniqueIds = [
    ...new Set(
      movieIds
        .map(Number)
        .filter(
          (id) =>
            Number.isInteger(id) &&
            id > 0
        )
    ),
  ];

  if (!uniqueIds.length) {
    return new Map();
  }

  const movies = await Movie.find({
    tmdbId: {
      $in: uniqueIds,
    },
  }).lean();

  return new Map(
    movies.map((movie) => [
      Number(movie.tmdbId),
      movie,
    ])
  );
}

async function getCustomPosterMap(
  userId,
  movieIds
) {
  if (!userId) {
    return new Map();
  }

  const uniqueIds = [
    ...new Set(
      movieIds
        .map(Number)
        .filter(
          (id) =>
            Number.isInteger(id) &&
            id > 0
        )
    ),
  ];

  if (!uniqueIds.length) {
    return new Map();
  }

  const posters =
    await CustomPoster.find({
      userId,
      movieId: {
        $in: uniqueIds,
      },
    })
      .select("movieId posterUrl")
      .lean();

  return new Map(
    posters.map((poster) => [
      Number(poster.movieId),
      poster.posterUrl,
    ])
  );
}

async function fetchMissingTmdbMovies(
  movieIds
) {
  const results = new Map();

  if (
    !TMDB_API_KEY ||
    !movieIds.length
  ) {
    return results;
  }

  const ids = movieIds.slice(0, 20);

  const responses = await Promise.allSettled(
    ids.map(async (movieId) => {
      const response = await axios.get(
        `https://api.themoviedb.org/3/movie/${movieId}`,
        {
          params: {
            api_key: TMDB_API_KEY,
          },
          timeout: 10000,
        }
      );

      return {
        movieId,
        data: response.data,
      };
    })
  );

  for (const response of responses) {
    if (response.status !== "fulfilled") {
      continue;
    }

    results.set(
      response.value.movieId,
      response.value.data
    );
  }

  return results;
}

async function formatListMovies(
  list
) {
  const movies = Array.isArray(list.movies)
    ? list.movies
    : [];

  const ownerId =
    list.user?._id || list.user;

  const movieIds = movies
    .map((movie) =>
      parseMovieId(
        movie.id ||
          movie.tmdbId ||
          movie.movieId
      )
    )
    .filter(Boolean);

  const [
    movieMetadataMap,
    customPosterMap,
  ] = await Promise.all([
    getMovieMetadataMap(movieIds),

    getCustomPosterMap(
      ownerId,
      movieIds
    ),
  ]);

  const missingMovieIds = movieIds.filter(
    (movieId) => {
      const metadata =
        movieMetadataMap.get(movieId);

      const rawMovie = movies.find(
        (movie) =>
          parseMovieId(
            movie.id ||
              movie.tmdbId ||
              movie.movieId
          ) === movieId
      );

      return (
        !metadata &&
        !rawMovie?.poster
      );
    }
  );

  const tmdbMetadataMap =
    await fetchMissingTmdbMovies(
      missingMovieIds
    );

  return movies.map((movie) => {
    const movieId = parseMovieId(
      movie.id ||
        movie.tmdbId ||
        movie.movieId
    );

    if (!movieId) {
      return {
        ...movie,
        title:
          movie.title ||
          "Unknown Title",
        posterOverride:
          DEFAULT_POSTER,
      };
    }

    const localMetadata =
      movieMetadataMap.get(movieId) || {};

    const tmdbMetadata =
      tmdbMetadataMap.get(movieId) || {};

    const customPoster =
      customPosterMap.get(movieId);

    const posterPath =
      movie.poster ||
      localMetadata.posterPath ||
      localMetadata.poster_path ||
      tmdbMetadata.poster_path ||
      null;

    const posterOverride =
      customPoster ||
      buildPosterUrl(posterPath) ||
      DEFAULT_POSTER;

    return {
      ...movie,
      id: movieId,

      title:
        movie.title ||
        localMetadata.title ||
        tmdbMetadata.title ||
        "Unknown Title",

      posterOverride,
    };
  });
}

// ============================================================
// PUBLIC AND COLLECTION ROUTES
// ============================================================

// GET /api/lists/popular
router.get(
  "/popular",
  async (req, res) => {
    try {
      const {
        limit,
        skip,
      } = parsePagination(
        req.query,
        50,
        50
      );

      const lists = await List.aggregate([
        {
          $match: {
            isPrivate: false,
          },
        },
        {
          $addFields: {
            likesCount: {
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
            likesCount: -1,
            updatedAt: -1,
            _id: -1,
          },
        },
        {
          $skip: skip,
        },
        {
          $limit: limit,
        },
      ]);

      await List.populate(lists, {
        path: "user",
        select: "username avatar",
      });

      return res.json(lists);
    } catch (error) {
      console.error(
        "❌ Error fetching popular lists:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to fetch popular lists",
      });
    }
  }
);

// GET /api/lists/friends
router.get(
  "/friends",
  protect,
  async (req, res) => {
    try {
      const user = await User.findById(
        req.user._id
      )
        .select("following")
        .lean();

      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      const followingIds =
        Array.isArray(user.following)
          ? user.following
          : [];

      if (!followingIds.length) {
        return res.json([]);
      }

      const {
        limit,
        skip,
      } = parsePagination(
        req.query,
        50,
        100
      );

      const lists = await List.find({
        user: {
          $in: followingIds,
        },
        isPrivate: false,
      })
        .sort({
          updatedAt: -1,
          _id: -1,
        })
        .skip(skip)
        .limit(limit)
        .populate(
          "user",
          "username avatar"
        )
        .lean();

      return res.json(lists);
    } catch (error) {
      console.error(
        "🔥 Failed to fetch friends' lists:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to fetch friends' lists",
      });
    }
  }
);

// POST /api/lists
router.post(
  "/",
  protect,
  async (req, res) => {
    try {
      const title = cleanString(
        req.body.title,
        200
      );

      if (!title) {
        return res.status(400).json({
          message: "List title is required",
        });
      }

      const list = await List.create({
        user: req.user._id,

        title,

        description: cleanString(
          req.body.description,
          5000
        ),

        coverImage: cleanString(
          req.body.coverImage,
          2000
        ),

        isPrivate:
          parseBooleanValue(
            req.body.isPrivate
          ),

        isRanked:
          parseBooleanValue(
            req.body.isRanked
          ),

        movies: cleanMovies(
          req.body.movies
        ),
      });

      return res.status(201).json(list);
    } catch (error) {
      console.error(
        "❌ Failed to create list:",
        error
      );

      return res.status(500).json({
        message: "Failed to create list",
      });
    }
  }
);

// GET /api/lists/my
router.get(
  "/my",
  protect,
  async (req, res) => {
    try {
      const {
        limit,
        skip,
      } = parsePagination(
        req.query,
        100,
        100
      );

      const lists = await List.find({
        user: req.user._id,
      })
        .sort({
          updatedAt: -1,
          _id: -1,
        })
        .skip(skip)
        .limit(limit)
        .populate(
          "user",
          "username avatar"
        )
        .lean();

      return res.json(lists);
    } catch (error) {
      console.error(
        "❌ Failed to fetch my lists:",
        error
      );

      return res.status(500).json({
        message: "Failed to fetch my lists",
      });
    }
  }
);

// GET /api/lists/saved
router.get(
  "/saved",
  protect,
  async (req, res) => {
    try {
      const {
        limit,
        skip,
      } = parsePagination(
        req.query,
        100,
        100
      );

      const lists = await List.find({
        savedBy: req.user._id,

        $or: [
          {
            isPrivate: false,
          },
          {
            user: req.user._id,
          },
        ],
      })
        .sort({
          updatedAt: -1,
          _id: -1,
        })
        .skip(skip)
        .limit(limit)
        .populate(
          "user",
          "username avatar"
        )
        .lean();

      return res.json(lists);
    } catch (error) {
      console.error(
        "❌ Failed to fetch saved lists:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to get saved lists",
      });
    }
  }
);

// GET /api/lists/user/:userId
router.get(
  "/user/:userId",
  protectOptional,
  async (req, res) => {
    try {
      const { userId } = req.params;

      if (!isValidObjectId(userId)) {
        return res.status(400).json({
          message: "Invalid user ID",
        });
      }

      const userExists = await User.exists({
        _id: userId,
      });

      if (!userExists) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      const isOwner =
        req.user &&
        String(req.user._id) ===
          String(userId);

      const filter = isOwner
        ? {
            user: userId,
          }
        : {
            user: userId,
            isPrivate: false,
          };

      const {
        limit,
        skip,
      } = parsePagination(
        req.query,
        100,
        100
      );

      const lists = await List.find(filter)
        .sort({
          updatedAt: -1,
          _id: -1,
        })
        .skip(skip)
        .limit(limit)
        .populate(
          "user",
          "username avatar"
        )
        .lean();

      return res.json(lists);
    } catch (error) {
      console.error(
        "❌ Failed to fetch user lists:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to get user lists",
      });
    }
  }
);

// GET /api/lists/search
router.get(
  "/search",
  protect,
  async (req, res) => {
    try {
      const query = cleanString(
        req.query.query,
        100
      );

      if (!query) {
        return res.status(400).json({
          message: "Query is required",
        });
      }

      const regex = new RegExp(
        escapeRegex(query),
        "i"
      );

      const {
        limit,
        skip,
      } = parsePagination(
        req.query,
        20,
        50
      );

      const lists = await List.find({
        title: regex,
        isPrivate: false,
      })
        .sort({
          updatedAt: -1,
          _id: -1,
        })
        .skip(skip)
        .limit(limit)
        .populate(
          "user",
          "username avatar"
        )
        .lean();

      return res.json(lists);
    } catch (error) {
      console.error(
        "❌ List search failed:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to search lists",
      });
    }
  }
);

// ============================================================
// INDIVIDUAL LIST
// ============================================================

// GET /api/lists/:id
router.get(
  "/:id",
  protect,
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          message: "Invalid list ID",
        });
      }

      const list = await List.findById(id)
        .populate(
          "user",
          "username avatar"
        );

      if (!list) {
        return res.status(404).json({
          message: "List not found",
        });
      }

      if (
        !canViewList(
          list,
          req.user._id
        )
      ) {
        return res.status(403).json({
          message:
            "This list is private",
        });
      }

      const movies =
        await formatListMovies(list);

      return res.json({
        ...list.toObject(),
        movies,
      });
    } catch (error) {
      console.error(
        "❌ Failed to fetch list:",
        error
      );

      return res.status(500).json({
        message: "Failed to fetch list",
      });
    }
  }
);

// ============================================================
// LIKES AND SAVES
// ============================================================

// POST /api/lists/:id/like
router.post(
  "/:id/like",
  protect,
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          message: "Invalid list ID",
        });
      }

      const list = await List.findById(id)
        .populate(
          "user",
          "username avatar deviceToken"
        );

      if (!list) {
        return res.status(404).json({
          message: "List not found",
        });
      }

      if (
        !canViewList(
          list,
          req.user._id
        )
      ) {
        return res.status(403).json({
          message:
            "This list is private",
        });
      }

      if (!Array.isArray(list.likes)) {
        list.likes = [];
      }

      const userId = String(
        req.user._id
      );

      const alreadyLiked =
        list.likes.some(
          (likeId) =>
            String(likeId) === userId
        );

      if (alreadyLiked) {
        list.likes = list.likes.filter(
          (likeId) =>
            String(likeId) !== userId
        );
      } else {
        list.likes.push(req.user._id);
      }

      await list.save();

      const listOwnerId =
        list.user?._id || list.user;

      if (
        !alreadyLiked &&
        listOwnerId &&
        String(listOwnerId) !== userId
      ) {
        const sender =
          await User.findById(
            req.user._id
          )
            .select(
              "username avatar"
            )
            .lean();

        const notification =
          await Notification.create({
            type: "list_like",
            message: `@${
              sender?.username || "Someone"
            } liked your list!`,
            from: req.user._id,
            to: listOwnerId,
            listId: list._id,
            relatedId: list._id,
            read: false,
          });

        const io = req.app.get("io");

        io
          ?.to(String(listOwnerId))
          .emit("notification", {
            ...notification.toObject(),
            from: sender,
          });

        const deviceToken =
          list.user?.deviceToken;

        const firebaseAdmin =
          req.app.get(
            "firebaseAdmin"
          );

        if (
          deviceToken &&
          firebaseAdmin?.messaging
        ) {
          try {
            await firebaseAdmin
              .messaging()
              .send({
                token: deviceToken,

                notification: {
                  title:
                    "New Like on Your List!",

                  body: `@${
                    sender?.username ||
                    "Someone"
                  } liked your list!`,
                },

                data: {
                  type: "list_like",
                  listId:
                    list._id.toString(),

                  senderId:
                    req.user._id.toString(),
                },
              });
          } catch (pushError) {
            console.warn(
              "⚠️ List-like push failed:",
              pushError.message
            );
          }
        }
      }

      return res.json({
        liked: !alreadyLiked,
        likesCount: list.likes.length,
      });
    } catch (error) {
      console.error(
        "❌ Failed to like/unlike list:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to like/unlike list",
      });
    }
  }
);

// POST /api/lists/:id/save
router.post(
  "/:id/save",
  protect,
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          message: "Invalid list ID",
        });
      }

      const list = await List.findById(id);

      if (!list) {
        return res.status(404).json({
          message: "List not found",
        });
      }

      if (
        !canViewList(
          list,
          req.user._id
        )
      ) {
        return res.status(403).json({
          message:
            "This list is private",
        });
      }

      if (!Array.isArray(list.savedBy)) {
        list.savedBy = [];
      }

      const userId = String(
        req.user._id
      );

      const alreadySaved =
        list.savedBy.some(
          (savedUserId) =>
            String(savedUserId) === userId
        );

      if (alreadySaved) {
        list.savedBy =
          list.savedBy.filter(
            (savedUserId) =>
              String(savedUserId) !== userId
          );
      } else {
        list.savedBy.push(
          req.user._id
        );
      }

      await list.save();

      return res.json({
        saved: !alreadySaved,
        savedCount:
          list.savedBy.length,
      });
    } catch (error) {
      console.error(
        "❌ Failed to save/unsave list:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to save list",
      });
    }
  }
);

// ============================================================
// OWNER OPERATIONS
// ============================================================

// PATCH /api/lists/:id
router.patch(
  "/:id",
  protect,
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          message: "Invalid list ID",
        });
      }

      const list = await List.findOne({
        _id: id,
        user: req.user._id,
      });

      if (!list) {
        const exists = await List.exists({
          _id: id,
        });

        return res
          .status(exists ? 403 : 404)
          .json({
            message: exists
              ? "Unauthorized"
              : "List not found",
          });
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "title"
        )
      ) {
        const title = cleanString(
          req.body.title,
          200
        );

        if (!title) {
          return res.status(400).json({
            message:
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
        list.description = cleanString(
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
        list.coverImage = cleanString(
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
          parseBooleanValue(
            req.body.isPrivate
          );
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "isRanked"
        )
      ) {
        list.isRanked =
          parseBooleanValue(
            req.body.isRanked
          );
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "movies"
        )
      ) {
        if (!Array.isArray(req.body.movies)) {
          return res.status(400).json({
            message:
              "Movies must be an array",
          });
        }

        list.movies = cleanMovies(
          req.body.movies
        );
      }

      const updated = await list.save();

      return res.json(updated);
    } catch (error) {
      console.error(
        "❌ Failed to update list:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to update list",
      });
    }
  }
);

// DELETE /api/lists/:id
router.delete(
  "/:id",
  protect,
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          message: "Invalid list ID",
        });
      }

      const deletedList =
        await List.findOneAndDelete({
          _id: id,
          user: req.user._id,
        });

      if (!deletedList) {
        const exists = await List.exists({
          _id: id,
        });

        return res
          .status(exists ? 403 : 404)
          .json({
            message: exists
              ? "Unauthorized"
              : "List not found",
          });
      }

      await Notification.deleteMany({
        $or: [
          {
            listId: deletedList._id,
          },
          {
            relatedId:
              deletedList._id,
          },
        ],
      });

      return res.json({
        message: "✅ List deleted",
      });
    } catch (error) {
      console.error(
        "❌ Failed to delete list:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to delete list",
      });
    }
  }
);

// POST /api/lists/:id/add
router.post(
  "/:id/add",
  protect,
  async (req, res) => {
    try {
      const { id: listId } = req.params;

      if (!isValidObjectId(listId)) {
        return res.status(400).json({
          message: "Invalid list ID",
        });
      }

      const list = await List.findOne({
        _id: listId,
        user: req.user._id,
      });

      if (!list) {
        const exists = await List.exists({
          _id: listId,
        });

        return res
          .status(exists ? 403 : 404)
          .json({
            message: exists
              ? "Unauthorized"
              : "List not found",
          });
      }

      const movie = cleanMovie(req.body);

      if (!movie) {
        return res.status(400).json({
          message:
            "Valid movie id and title are required",
        });
      }

      if (
        list.movies.length >=
        MAX_LIST_MOVIES
      ) {
        return res.status(400).json({
          message:
            `A list can contain at most ${MAX_LIST_MOVIES} movies`,
        });
      }

      const alreadyExists =
        list.movies.some(
          (existingMovie) =>
            Number(existingMovie.id) ===
            movie.id
        );

      if (alreadyExists) {
        return res.status(409).json({
          message:
            "Movie already in list",
        });
      }

      list.movies.push(movie);
      await list.save();

      return res.json({
        message: "✅ Movie added",
        list,
      });
    } catch (error) {
      console.error(
        "❌ Failed to add movie:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to add movie",
      });
    }
  }
);

// ============================================================
// SHARING
// ============================================================

// POST /api/lists/:id/share
router.post(
  "/:id/share",
  protect,
  async (req, res) => {
    try {
      const listId = req.params.id;
      const { recipients } = req.body;

      if (!isValidObjectId(listId)) {
        return res.status(400).json({
          message: "Invalid list ID",
        });
      }

      if (!Array.isArray(recipients)) {
        return res.status(400).json({
          message:
            "Recipients must be an array",
        });
      }

      const list = await List.findById(
        listId
      ).select(
        "_id user isPrivate title"
      );

      if (!list) {
        return res.status(404).json({
          message: "List not found",
        });
      }

      if (
        !canViewList(
          list,
          req.user._id
        )
      ) {
        return res.status(403).json({
          message:
            "This list is private",
        });
      }

      const sender = await User.findById(
        req.user._id
      )
        .select("username avatar")
        .lean();

      if (!sender) {
        return res.status(404).json({
          message: "Sender not found",
        });
      }

      const uniqueRecipientIds = [
        ...new Set(
          recipients
            .map((recipientId) =>
              String(
                recipientId || ""
              ).trim()
            )
            .filter(
              (recipientId) =>
                isValidObjectId(
                  recipientId
                ) &&
                recipientId !==
                  String(req.user._id)
            )
        ),
      ].slice(
        0,
        MAX_SHARE_RECIPIENTS
      );

      if (!uniqueRecipientIds.length) {
        return res.status(400).json({
          message:
            "At least one valid recipient is required",
        });
      }

      const validRecipients =
        await User.find({
          _id: {
            $in: uniqueRecipientIds,
          },
        })
          .select("_id")
          .lean();

      if (!validRecipients.length) {
        return res.status(404).json({
          message:
            "No valid recipients were found",
        });
      }

      const notifications =
        await Notification.insertMany(
          validRecipients.map(
            (recipient) => ({
              type: "share-list",

              message:
                "suggested you check out their list!",

              from: req.user._id,
              to: recipient._id,

              listId: list._id,
              relatedId: list._id,

              read: false,
            })
          )
        );

      const io = req.app.get("io");

      notifications.forEach(
        (notification) => {
          io
            ?.to(
              String(notification.to)
            )
            .emit("notification", {
              ...notification.toObject(),
              from: sender,
            });
        }
      );

      return res.json({
        success: true,
        sentCount:
          notifications.length,
      });
    } catch (error) {
      console.error(
        "❌ Failed to share list:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to share list",
      });
    }
  }
);

module.exports = router;

