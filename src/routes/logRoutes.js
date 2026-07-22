const express = require('express');
const router = express.Router();
const Log = require('../models/log');
const User = require('../models/user');
const protect = require('../middleware/authMiddleware');
const multer = require("multer");
const { uploadToCloudinary } = require("../utils/cloudinary");
const axios = require("axios"); // Add this at top if not already
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";
const TMDB_API_KEY = process.env.TMDB_API_KEY; // Add this at top if not already
const CustomPoster = require('../models/customPoster');
const TMDB_BACKDROP = "https://image.tmdb.org/t/p/original";
const DEFAULT_POSTER = "/default-poster.jpg";
const DEFAULT_BACKDROP = "/default-backdrop.jpg";
const DEFAULT_AVATAR = "/default-avatar.jpg";
const Notification = require('../models/notification');
const Movie = require("../models/movieModel");
const mongoose = require("mongoose");

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 8 * 1024 * 1024,
  },

  fileFilter: (req, file, callback) => {
    if (
      file.mimetype &&
      file.mimetype.startsWith("image/")
    ) {
      return callback(null, true);
    }

    return callback(
      new multer.MulterError(
        "LIMIT_UNEXPECTED_FILE",
        file.fieldname
      )
    );
  },
});
const cleanFavoriteCharacter = (favoriteCharacter) => {
  if (!favoriteCharacter) return null;

  let parsed = favoriteCharacter;

  // Because /full and PATCH use multipart/form-data,
  // favoriteCharacter may arrive as a JSON string.
  if (typeof favoriteCharacter === "string") {
    try {
      parsed = JSON.parse(favoriteCharacter);
    } catch (err) {
      console.warn("⚠️ Failed to parse favoriteCharacter:", err.message);
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object") return null;

  const characterName = String(parsed.characterName || "").trim();

  if (!characterName) return null;

  const safeNumberOrNull = (value) => {
    if (value === undefined || value === null || value === "") return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  return {
    characterId: safeNumberOrNull(parsed.characterId),
    actorId: safeNumberOrNull(parsed.actorId),
    characterName,
    actorName: String(parsed.actorName || "").trim(),
    profilePath: String(parsed.profilePath || "").trim(),
  };
};

const isValidObjectId = (value) =>
  mongoose.Types.ObjectId.isValid(value);

const parsePositiveInteger = (value) => {
  const number = Number(value);

  if (
    !Number.isInteger(number) ||
    number <= 0
  ) {
    return null;
  }

  return number;
};

const parseRating = (value) => {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return 0;
  }

  const number = Number(value);

  if (
    !Number.isFinite(number) ||
    number < 0 ||
    number > 5
  ) {
    return null;
  }

  return number;
};

const parseRewatchCount = (value) => {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return 0;
  }

  const number = Number(value);

  if (
    !Number.isInteger(number) ||
    number < 0 ||
    number > 10000
  ) {
    return null;
  }

  return number;
};

const parseBooleanValue = (value) =>
  value === true || value === "true";

const parseOptionalDate = (value) => {
  if (!value) return new Date();

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;
};

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

async function synchronizeTotalLogs(userId) {
  const totalLogs = await Log.countDocuments({
    user: userId,
  });

  await User.findByIdAndUpdate(userId, {
    $set: { totalLogs },
  });

  return totalLogs;
}

const parsePagination = (
  query,
  defaultLimit = 60,
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

const buildTmdbImageUrl = (
  value,
  baseUrl = TMDB_IMG
) => {
  if (!value) return null;

  const image = String(value).trim();

  if (!image) return null;

  if (
    image.startsWith("http://") ||
    image.startsWith("https://")
  ) {
    return image;
  }

  if (image.startsWith("/")) {
    return `${baseUrl}${image}`;
  }

  return image;
};

async function getMovieMetadataMap(
  tmdbIds
) {
  const uniqueIds = [
    ...new Set(
      tmdbIds
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
    tmdbId: { $in: uniqueIds },
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
  tmdbIds
) {
  const uniqueIds = [
    ...new Set(
      tmdbIds
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

  const customPosters =
    await CustomPoster.find({
      userId,
      movieId: { $in: uniqueIds },
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

const getLogTmdbId = (log) => {
  const possibleId =
    log.tmdbId ||
    log.movie?.tmdbId ||
    log.movie?.id ||
    (
      typeof log.movie === "number"
        ? log.movie
        : null
    );

  const tmdbId = Number(possibleId);

  return Number.isInteger(tmdbId) &&
    tmdbId > 0
    ? tmdbId
    : null;
};

const formatRetrievedLog = ({
  log,
  movieMetadata,
  customPosterUrl,
}) => {
  const tmdbId = getLogTmdbId(log);

  if (!tmdbId) return null;

  const metadata = movieMetadata || {};

  const posterPath =
    metadata.posterPath ||
    metadata.poster_path ||
    log.poster ||
    null;

  const backdropPath =
    metadata.backdropPath ||
    metadata.backdrop_path ||
    log.backdrop ||
    null;

  const normalPoster =
    buildTmdbImageUrl(posterPath);

  const posterOverride =
    customPosterUrl ||
    normalPoster ||
    DEFAULT_POSTER;

  return {
    ...log,

    posterOverride,

    movie: {
      id: tmdbId,
      tmdbId,

      title:
        metadata.title ||
        log.title ||
        "Untitled",

      poster_path:
        metadata.posterPath ||
        metadata.poster_path ||
        log.poster ||
        null,

      backdrop_path:
        metadata.backdropPath ||
        metadata.backdrop_path ||
        log.backdrop ||
        null,

      runtime:
        metadata.runtime || null,

      release_date:
        metadata.releaseDate ||
        metadata.release_date ||
        null,
    },
  };
};

router.post("/:logId/like",protect,async (req, res) => {
    try {
      const { logId } = req.params;

      if (!isValidObjectId(logId)) {
        return res.status(400).json({
          message: "Invalid log ID",
        });
      }

      const log = await Log.findById(logId)
        .populate(
          "user",
          "username avatar"
        );

      if (!log) {
        return res.status(404).json({
          message: "Log not found",
        });
      }

      if (!Array.isArray(log.likes)) {
        log.likes = [];
      }

      const userId = req.user._id;

      const alreadyLiked = log.likes.some(
        (id) =>
          String(id) === String(userId)
      );

      if (alreadyLiked) {
        log.likes = log.likes.filter(
          (id) =>
            String(id) !== String(userId)
        );
      } else {
        log.likes.push(userId);
      }

      await log.save();

      const logOwnerId =
        log.user?._id || log.user;

      if (
        !alreadyLiked &&
        logOwnerId &&
        String(logOwnerId) !==
          String(userId)
      ) {
        /*
         * Use Scene's unified notification pipeline.
         *
         * This creates the in-app notification, emits the Socket.IO
         * event, sends the Expo/FCM device push, respects muteLikes,
         * and stores the exact Movie review navigation target.
         */
        try {
          const movieId =
            String(
              log.movie?.id ||
              log.movie?._id ||
              log.movie ||
              log.movieId ||
              log.tmdbId ||
              ""
            );

          const movieTitle =
            String(
              log.title ||
              log.movieTitle ||
              log.movie?.title ||
              log.movie?.name ||
              ""
            );

          const moviePoster =
            String(
              log.poster ||
              log.posterPath ||
              log.poster_path ||
              log.movie?.poster ||
              log.movie?.posterPath ||
              log.movie?.poster_path ||
              ""
            );

          await sendNotification({
            type:
              "movie_review_like",

            fromUserId:
              userId,

            toUserId:
              logOwnerId,

            mediaType:
              "movie",

            targetType:
              "movieReview",

            relatedId:
              String(log._id),

            reviewId:
              String(log._id),

            movieLogId:
              log._id,

            movieId,
            movieTitle,
            moviePoster,

            deduplicationKey:
              `movie-review-like:${String(
                log._id
              )}:${String(userId)}`,
          });
        } catch (notificationError) {
          /*
           * A notification failure must never undo a successful like.
           */
          console.error(
            "❌ Movie review-like notification failed:",
            notificationError?.message ||
            notificationError
          );
        }
      }

      return res.json({
        liked: !alreadyLiked,
        likesCount: log.likes.length,
      });
    } catch (error) {
      console.error(
        "❌ Failed to like/unlike review:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to like/unlike review",
      });
    }
  }
);

router.get("/proxy/tmdb/images/:movieId",async (req, res) => {
    try {
      const movieId = parsePositiveInteger(
        req.params.movieId
      );

      if (!movieId) {
        return res.status(400).json({
          error: "Invalid movie ID",
        });
      }

      if (!TMDB_API_KEY) {
        return res.status(503).json({
          error: "TMDB service is unavailable",
        });
      }

      const tmdbResponse = await axios.get(
        `https://api.themoviedb.org/3/movie/${movieId}/images`,
        {
          params: {
            api_key: TMDB_API_KEY,
            include_image_language:
              "en,null",
          },
          timeout: 10000,
        }
      );

      const data = tmdbResponse.data || {};

      return res.json({
        id: data.id || movieId,

        backdrops: Array.isArray(
          data.backdrops
        )
          ? data.backdrops.slice(0, 100)
          : [],

        posters: Array.isArray(
          data.posters
        )
          ? data.posters.slice(0, 100)
          : [],

        logos: Array.isArray(data.logos)
          ? data.logos.slice(0, 50)
          : [],
      });
    } catch (error) {
      const status =
        error.response?.status;

      console.error(
        `❌ TMDB images proxy failed for movieId=${req.params.movieId}:`,
        error.message
      );

      return res.status(
        status === 404 ? 404 : 502
      ).json({
        error:
          status === 404
            ? "Movie images not found"
            : "TMDB images request failed",
      });
    }
  }
);

router.get("/proxy/tmdb",async (req, res) => {
    try {
      const rawUrl =
        typeof req.query.url === "string"
          ? req.query.url.trim()
          : "";

      if (!rawUrl) {
        return res.status(400).send(
          "No URL provided."
        );
      }

      let imageUrl;

      try {
        imageUrl = new URL(rawUrl);
      } catch {
        return res.status(400).send(
          "Invalid URL."
        );
      }

      /*
       * Prevent the backend from being used
       * as an unrestricted URL proxy.
       */
      if (
        imageUrl.protocol !== "https:" ||
        imageUrl.hostname !==
          "image.tmdb.org"
      ) {
        return res.status(403).send(
          "Only TMDB images may be proxied."
        );
      }

      /*
       * Only permit normal TMDB image paths.
       */
      if (
        !imageUrl.pathname.startsWith(
          "/t/p/"
        )
      ) {
        return res.status(403).send(
          "Invalid TMDB image path."
        );
      }

      const response = await axios.get(
        imageUrl.toString(),
        {
          responseType: "stream",
          timeout: 10000,
          maxRedirects: 0,

          /*
           * Prevent unexpectedly huge files
           * from being buffered or streamed.
           */
          maxContentLength:
            15 * 1024 * 1024,

          headers: {
            Accept: "image/*",
          },
        }
      );

      const contentType = String(
        response.headers[
          "content-type"
        ] || ""
      ).toLowerCase();

      if (
        !contentType.startsWith("image/")
      ) {
        response.data.destroy?.();

        return res.status(415).send(
          "Requested resource is not an image."
        );
      }

      res.setHeader(
        "Content-Type",
        contentType
      );

      res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
      );

      res.setHeader(
        "Cache-Control",
        "public, max-age=86400"
      );

      const contentLength =
        response.headers[
          "content-length"
        ];

      if (contentLength) {
        res.setHeader(
          "Content-Length",
          contentLength
        );
      }

      response.data.on(
        "error",
        (streamError) => {
          console.error(
            "❌ TMDB image stream failed:",
            streamError.message
          );

          if (!res.headersSent) {
            res.status(502).end(
              "Image stream failed."
            );
          } else {
            res.destroy();
          }
        }
      );

      return response.data.pipe(res);
    } catch (error) {
      const upstreamStatus =
        error.response?.status;

      console.error(
        "❌ Failed to proxy TMDB image:",
        error.message
      );

      if (upstreamStatus === 404) {
        return res.status(404).send(
          "Image not found."
        );
      }

      if (
        error.code === "ECONNABORTED"
      ) {
        return res.status(504).send(
          "TMDB image request timed out."
        );
      }

      return res.status(502).send(
        "Proxy failed."
      );
    }
  }
);

router.get("/:logId/replies",async (req, res) => {
    try {
      const { logId } = req.params;

      if (!isValidObjectId(logId)) {
        return res.status(400).json({
          message: "Invalid log ID",
        });
      }

      const log = await Log.findById(logId)
        .select("tmdbId movie replies")
        .lean();

      if (!log) {
        return res.status(404).json({
          message: "Log not found",
        });
      }

      const replies = Array.isArray(log.replies)
        ? log.replies
        : [];

      if (!replies.length) {
        return res.json([]);
      }

      const replyUserIds = [
        ...new Set(
          replies
            .map((reply) => {
              const rawUserId =
                reply.user?._id ||
                reply.user;

              return rawUserId
                ? String(rawUserId)
                : null;
            })
            .filter(
              (userId) =>
                userId &&
                isValidObjectId(userId)
            )
        ),
      ];

      const users = replyUserIds.length
        ? await User.find({
            _id: {
              $in: replyUserIds,
            },
          })
            .select("username avatar")
            .lean()
        : [];

      const userMap = new Map(
        users.map((user) => [
          String(user._id),
          user,
        ])
      );

      const tmdbId =
        getLogTmdbId(log);

      const ratingMap = new Map();

      if (tmdbId && replyUserIds.length) {
        const userLogs = await Log.find({
          user: {
            $in: replyUserIds,
          },
          tmdbId,
        })
          .select("user rating createdAt")
          .sort({
            createdAt: -1,
          })
          .lean();

        for (const userLog of userLogs) {
          const userId = String(
            userLog.user
          );

          /*
           * Keep the newest rating when
           * someone logged the movie more
           * than once.
           */
          if (!ratingMap.has(userId)) {
            ratingMap.set(
              userId,
              userLog.rating ?? null
            );
          }
        }
      }

      const formattedReplies = replies.map(
        (reply) => {
          const rawUserId =
            reply.user?._id ||
            reply.user;

          const userId =
            rawUserId &&
            isValidObjectId(rawUserId)
              ? String(rawUserId)
              : null;

          const replyUser = userId
            ? userMap.get(userId)
            : null;

          return {
            _id: reply._id,

            text:
              typeof reply.text === "string"
                ? reply.text
                : "",

            gif:
              typeof reply.gif === "string"
                ? reply.gif
                : "",

            image:
              typeof reply.image === "string"
                ? reply.image
                : "",

            createdAt:
              reply.createdAt || null,

            username:
              replyUser?.username ||
              "Deleted User",

            avatar:
              replyUser?.avatar ||
              DEFAULT_AVATAR,

            userId:
              replyUser?._id || null,

            likes: Array.isArray(
              reply.likes
            )
              ? reply.likes
              : [],

            rating: userId
              ? ratingMap.get(userId) ??
                null
              : null,

            parentComment:
              reply.parentComment || null,
          };
        }
      );

      return res.json(formattedReplies);
    } catch (error) {
      console.error(
        "🔥 Error fetching replies:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to fetch replies",
      });
    }
  }
);

router.get("/:logId",async (req, res) => {
    try {
      const { logId } = req.params;

      if (!isValidObjectId(logId)) {
        return res.status(400).json({
          message: "Invalid log ID",
        });
      }

      const log = await Log.findById(logId)
        .populate(
          "user",
          "username avatar"
        )
        .lean();

      if (!log) {
        return res.status(404).json({
          message: "Log not found",
        });
      }

      const tmdbId = getLogTmdbId(log);

      const logOwnerId =
        log.user?._id ||
        log.user ||
        null;

      let movieTitle =
        log.title || "Untitled";

      let tmdbPosterPath = null;
      let backdropPath = null;

      /*
       * First use locally stored movie data.
       * This avoids calling TMDB when Scene
       * already has the information.
       */
      let localMovie = null;

      if (tmdbId) {
        localMovie = await Movie.findOne({
          tmdbId,
        })
          .select(
            "title posterPath backdropPath releaseDate runtime"
          )
          .lean();

        if (localMovie) {
          movieTitle =
            localMovie.title ||
            movieTitle;

          tmdbPosterPath =
            localMovie.posterPath ||
            null;

          backdropPath =
            localMovie.backdropPath ||
            null;
        }
      }

      /*
       * Only request TMDB when local movie
       * metadata is incomplete.
       */
      if (
        tmdbId &&
        TMDB_API_KEY &&
        (
          !localMovie ||
          !tmdbPosterPath ||
          !backdropPath
        )
      ) {
        try {
          const tmdbResponse =
            await axios.get(
              `https://api.themoviedb.org/3/movie/${tmdbId}`,
              {
                params: {
                  api_key: TMDB_API_KEY,
                },
                timeout: 10000,
              }
            );

          const tmdbMovie =
            tmdbResponse.data || {};

          movieTitle =
            tmdbMovie.title ||
            movieTitle;

          tmdbPosterPath =
            tmdbMovie.poster_path ||
            tmdbPosterPath;

          backdropPath =
            tmdbMovie.backdrop_path ||
            backdropPath;

          /*
           * Some movies have no backdrop on
           * the normal details response.
           */
          if (!backdropPath) {
            const imagesResponse =
              await axios.get(
                `https://api.themoviedb.org/3/movie/${tmdbId}/images`,
                {
                  params: {
                    api_key: TMDB_API_KEY,
                    include_image_language:
                      "en,null",
                  },
                  timeout: 10000,
                }
              );

            backdropPath =
              imagesResponse.data
                ?.backdrops?.[0]
                ?.file_path ||
              null;
          }
        } catch (tmdbError) {
          console.warn(
            `⚠️ Failed to fetch TMDB for tmdbId=${tmdbId}:`,
            tmdbError.message
          );
        }
      }

      /*
       * Fetch the review owner's selected
       * custom poster.
       */
      let customPoster = null;

      if (logOwnerId && tmdbId) {
        customPoster =
          await CustomPoster.findOne({
            userId: logOwnerId,
            movieId: tmdbId,
          })
            .select("posterUrl")
            .lean();
      }

      let poster = DEFAULT_POSTER;

      if (customPoster?.posterUrl) {
        poster = customPoster.posterUrl;
      } else if (log.poster) {
        poster =
          buildTmdbImageUrl(log.poster) ||
          DEFAULT_POSTER;
      } else if (tmdbPosterPath) {
        poster =
          buildTmdbImageUrl(
            tmdbPosterPath
          ) || DEFAULT_POSTER;
      }

      const backdrop = backdropPath
        ? buildTmdbImageUrl(
            backdropPath,
            TMDB_BACKDROP
          )
        : (
            buildTmdbImageUrl(
              log.backdrop,
              TMDB_BACKDROP
            ) ||
            DEFAULT_BACKDROP
          );

      const replies = Array.isArray(
        log.replies
      )
        ? log.replies
        : [];

      /*
       * Collect every reply author once.
       */
      const replyUserIds = [
        ...new Set(
          replies
            .map((reply) => {
              const rawUserId =
                reply.user?._id ||
                reply.user;

              return rawUserId
                ? String(rawUserId)
                : null;
            })
            .filter(
              (userId) =>
                userId &&
                isValidObjectId(userId)
            )
        ),
      ];

      const [
        replyUsers,
        replyUserLogs,
        rewatchCount,
      ] = await Promise.all([
        replyUserIds.length
          ? User.find({
              _id: {
                $in: replyUserIds,
              },
            })
              .select("username avatar")
              .lean()
          : [],

        tmdbId && replyUserIds.length
          ? Log.find({
              user: {
                $in: replyUserIds,
              },
              tmdbId,
            })
              .select(
                "user rating createdAt"
              )
              .sort({
                createdAt: -1,
              })
              .lean()
          : [],

        logOwnerId && tmdbId
          ? Log.countDocuments({
              user: logOwnerId,
              tmdbId,
              rewatch: true,
            })
          : 0,
      ]);

      const replyUserMap = new Map(
        replyUsers.map((user) => [
          String(user._id),
          user,
        ])
      );

      const ratingMap = new Map();

      /*
       * Query is newest-first, so keep only
       * the first rating for each user.
       */
      for (const userLog of replyUserLogs) {
        const userId = String(
          userLog.user
        );

        if (!ratingMap.has(userId)) {
          ratingMap.set(
            userId,
            userLog.rating ?? null
          );
        }
      }

      const formattedReplies = replies.map(
        (reply) => {
          const rawUserId =
            reply.user?._id ||
            reply.user;

          const userId =
            rawUserId &&
            isValidObjectId(rawUserId)
              ? String(rawUserId)
              : null;

          const replyUser = userId
            ? replyUserMap.get(userId)
            : null;

          return {
            _id: reply._id,

            text:
              typeof reply.text === "string"
                ? reply.text
                : "",

            gif:
              typeof reply.gif === "string"
                ? reply.gif
                : "",

            image:
              typeof reply.image === "string"
                ? reply.image
                : "",

            createdAt:
              reply.createdAt || null,

            username:
              replyUser?.username ||
              "Deleted User",

            avatar:
              replyUser?.avatar ||
              DEFAULT_AVATAR,

            userId:
              replyUser?._id || null,

            likes: Array.isArray(
              reply.likes
            )
              ? reply.likes
              : [],

            ratingForThisMovie: userId
              ? ratingMap.get(userId) ??
                null
              : null,

            parentComment:
              reply.parentComment || null,
          };
        }
      );

      return res.json({
        _id: log._id,

        user: log.user || null,

        movie: {
          id: tmdbId,
          title: movieTitle,
          backdrop_path:
            backdropPath || null,
          poster,
        },

        poster,
        posterOverride: poster,
        backdrop,

        customBackdrop:
          log.customBackdrop || "",

        review: log.review || "",
        rating: log.rating ?? 0,

        favoriteCharacter:
          log.favoriteCharacter || null,

        rewatchCount,

        likes: Array.isArray(log.likes)
          ? log.likes
          : [],

        image: log.image || null,
        gif: log.gif || null,

        replies: formattedReplies,

        createdAt:
          log.createdAt || null,

        reviewBackdrop:
          backdropPath || null,
      });
    } catch (error) {
      console.error(
        "🔥 Error fetching individual log:",
        error
      );

      return res.status(500).json({
        message:
          "Server error fetching log",
      });
    }
  }
);

router.post("/:id/reply",protect,upload.single("image"),async (req, res) => {
    try {
      const logId = req.params.id;

      if (!isValidObjectId(logId)) {
        return res.status(400).json({
          message: "Invalid log ID",
        });
      }

      const {
        text,
        gif,
        externalImage,
        parentComment,
      } = req.body;

      const cleanText = cleanString(text, 3000);
      const cleanGif = cleanString(gif, 2000);
      const cleanExternalImage = cleanString(
        externalImage,
        2000
      );

      const log = await Log.findById(logId);

      if (!log) {
        return res.status(404).json({
          message: "Log not found",
        });
      }

      let parentReply = null;
      let parentCommentId = null;

      if (parentComment) {
        if (!isValidObjectId(parentComment)) {
          return res.status(400).json({
            message: "Invalid parent comment ID",
          });
        }

        parentReply = log.replies.id(parentComment);

        if (!parentReply) {
          return res.status(404).json({
            message: "Parent comment not found",
          });
        }

        parentCommentId = parentReply._id;
      }

      let uploadedImage = "";

      if (req.file?.buffer) {
        uploadedImage = await uploadToCloudinary(
          req.file.buffer,
          "scene/replies"
        );
      } else if (cleanExternalImage) {
        uploadedImage = cleanExternalImage;
      }

      if (
        !cleanText &&
        !cleanGif &&
        !uploadedImage
      ) {
        return res.status(400).json({
          message:
            "Reply must include text, image, or gif.",
        });
      }

      const newReply = {
        user: req.user._id,
        text: cleanText,
        gif: cleanGif,
        image: uploadedImage,
        parentComment: parentCommentId,
      };

      log.replies.push(newReply);

      const createdReply =
        log.replies[log.replies.length - 1];

      const createdReplyId =
        createdReply._id;

      await log.save();

      const fromUser = await User.findById(
        req.user._id
      )
        .select("username avatar")
        .lean();

      const io = req.app.get("io");

      // Notify review owner for a normal reply.
      if (
        !parentCommentId &&
        log.user &&
        String(log.user) !==
          String(req.user._id)
      ) {
        const notification =
          await Notification.create({
            type: "reply",
            message:
              "replied to your review",
            from: req.user._id,
            to: log.user,
            relatedId: log._id,
            read: false,
          });

        io
          ?.to(String(log.user))
          .emit("notification", {
            ...notification.toObject(),
            from: fromUser,
          });
      }

      // Notify the parent comment owner.
      if (parentCommentId && parentReply) {
        const parentOwnerId =
          parentReply.user?._id ||
          parentReply.user;

        if (
          parentOwnerId &&
          String(parentOwnerId) !==
            String(req.user._id)
        ) {
          const notification =
            await Notification.create({
              type: "reply",
              message:
                "replied to your comment",
              from: req.user._id,
              to: parentOwnerId,
              relatedId: log._id,
              read: false,
            });

          io
            ?.to(String(parentOwnerId))
            .emit("notification", {
              ...notification.toObject(),
              from: fromUser,
            });
        }
      }

      await log.populate(
        "replies.user",
        "username avatar"
      );

      const populatedReply =
        log.replies.id(createdReplyId);

      return res.status(201).json({
        _id: populatedReply._id,
        text: populatedReply.text || "",
        gif: populatedReply.gif || "",
        image: populatedReply.image || "",
        createdAt: populatedReply.createdAt,

        user: {
          _id:
            populatedReply.user?._id ||
            req.user._id,

          username:
            populatedReply.user?.username ||
            fromUser?.username ||
            "User",

          avatar:
            populatedReply.user?.avatar ||
            fromUser?.avatar ||
            DEFAULT_AVATAR,
        },

        parentComment:
          populatedReply.parentComment || null,

        likes: Array.isArray(
          populatedReply.likes
        )
          ? populatedReply.likes
          : [],

        logId: log._id,
      });
    } catch (error) {
      console.error(
        "🔥 Failed to post reply:",
        error
      );

      return res.status(500).json({
        message: "Failed to post reply",
      });
    }
  }
);

router.get("/movie/:id/popular",protect,async (req, res) => {
    try {
      const movieId = parsePositiveInteger(
        req.params.id
      );

      if (!movieId) {
        return res.status(400).json({
          message: "Invalid movie ID",
        });
      }

      const returnAll =
        req.query.all === "true";

      const limit = returnAll ? 50 : 3;

      /*
       * Mongo cannot reliably sort an array
       * using "likes.length", so calculate
       * the actual number of likes first.
       */
      const logs = await Log.aggregate([
        {
          $match: {
            tmdbId: movieId,
            review: {
              $exists: true,
              $nin: ["", "__media__"],
            },
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
            createdAt: -1,
            _id: -1,
          },
        },
        {
          $limit: limit,
        },
      ]);

      if (!logs.length) {
        return res.json([]);
      }

      /*
       * Populate review authors after the
       * aggregation query.
       */
      await Log.populate(logs, {
        path: "user",
        select: "username avatar",
      });

      /*
       * Collect every reply and legacy child
       * reply author in one pass.
       */
      const replyUserIds = new Set();

      for (const log of logs) {
        for (const reply of log.replies || []) {
          const replyUserId =
            reply.user?._id ||
            reply.user;

          if (
            replyUserId &&
            isValidObjectId(replyUserId)
          ) {
            replyUserIds.add(
              String(replyUserId)
            );
          }

          for (
            const child of reply.children || []
          ) {
            const childUserId =
              child.user?._id ||
              child.user;

            if (
              childUserId &&
              isValidObjectId(childUserId)
            ) {
              replyUserIds.add(
                String(childUserId)
              );
            }
          }
        }
      }

      const users = replyUserIds.size
        ? await User.find({
            _id: {
              $in: [...replyUserIds],
            },
          })
            .select("username avatar")
            .lean()
        : [];

      const userMap = new Map(
        users.map((user) => [
          String(user._id),
          user,
        ])
      );

      const formatReplyUser = (
        rawUser
      ) => {
        const rawUserId =
          rawUser?._id ||
          rawUser;

        const userId =
          rawUserId &&
          isValidObjectId(rawUserId)
            ? String(rawUserId)
            : null;

        const user = userId
          ? userMap.get(userId)
          : null;

        return {
          _id: user?._id || userId,
          username:
            user?.username ||
            "Deleted User",
          avatar:
            user?.avatar ||
            DEFAULT_AVATAR,
        };
      };

      const formattedLogs = logs.map(
        (log) => ({
          ...log,

          likes: Array.isArray(log.likes)
            ? log.likes
            : [],

          replies: (log.replies || []).map(
            (reply) => ({
              ...reply,

              user: formatReplyUser(
                reply.user
              ),

              likes: Array.isArray(
                reply.likes
              )
                ? reply.likes
                : [],

              children: (
                reply.children || []
              ).map((child) => ({
                ...child,

                user: formatReplyUser(
                  child.user
                ),

                likes: Array.isArray(
                  child.likes
                )
                  ? child.likes
                  : [],
              })),
            })
          ),
        })
      );

      return res.json(formattedLogs);
    } catch (error) {
      console.error(
        "❌ Failed to fetch popular reviews:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to fetch popular reviews",
      });
    }
  }
);

router.get("/movie/:id/friends",protect,async (req, res) => {
    try {
      const movieId = parsePositiveInteger(
        req.params.id
      );

      if (!movieId) {
        return res.status(400).json({
          message: "Invalid movie ID",
        });
      }

      const currentUser = await User.findById(
        req.user._id
      )
        .select("following")
        .lean();

      if (!currentUser) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      const followingIds = Array.isArray(
        currentUser.following
      )
        ? currentUser.following
        : [];

      if (!followingIds.length) {
        return res.json([]);
      }

      const requestedLimit = Number(
        req.query.limit
      );

      const limit =
        Number.isInteger(requestedLimit) &&
        requestedLimit > 0
          ? Math.min(requestedLimit, 50)
          : 20;

      const logs = await Log.find({
        tmdbId: movieId,
        user: {
          $in: followingIds,
        },
      })
        .populate(
          "user",
          "username avatar"
        )
        .populate(
          "replies.user",
          "username avatar"
        )
        .sort({
          createdAt: -1,
          _id: -1,
        })
        .limit(limit)
        .lean();

      const formattedLogs = logs.map(
        (log) => ({
          ...log,

          likes: Array.isArray(log.likes)
            ? log.likes
            : [],

          replies: Array.isArray(log.replies)
            ? log.replies.map((reply) => ({
                ...reply,

                user: reply.user || {
                  _id: null,
                  username: "Deleted User",
                  avatar: DEFAULT_AVATAR,
                },

                likes: Array.isArray(
                  reply.likes
                )
                  ? reply.likes
                  : [],
              }))
            : [],
        })
      );

      return res.json(formattedLogs);
    } catch (error) {
      console.error(
        "❌ Failed to fetch friends' reviews:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to fetch friends' reviews",
      });
    }
  }
);

router.get("/movie/:id/all",protect,async (req, res) => {
    try {
      const movieId = parsePositiveInteger(
        req.params.id
      );

      if (!movieId) {
        return res.status(400).json({
          message: "Invalid movie ID",
        });
      }

      const {
        limit,
        skip,
      } = parsePagination(
        req.query,
        50,
        100
      );

      const logs = await Log.find({
        tmdbId: movieId,
      })
        .populate(
          "user",
          "username avatar"
        )
        .populate(
          "replies.user",
          "username avatar"
        )
        .sort({
          createdAt: -1,
          _id: -1,
        })
        .skip(skip)
        .limit(limit)
        .lean();

      const formattedLogs = logs.map(
        (log) => ({
          ...log,

          user: log.user || {
            _id: null,
            username: "Deleted User",
            avatar: DEFAULT_AVATAR,
          },

          likes: Array.isArray(log.likes)
            ? log.likes
            : [],

          replies: Array.isArray(log.replies)
            ? log.replies.map((reply) => ({
                ...reply,

                user: reply.user || {
                  _id: null,
                  username: "Deleted User",
                  avatar: DEFAULT_AVATAR,
                },

                likes: Array.isArray(
                  reply.likes
                )
                  ? reply.likes
                  : [],
              }))
            : [],
        })
      );

      return res.json(formattedLogs);
    } catch (error) {
      console.error(
        "❌ Failed to fetch all movie reviews:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to fetch all movie reviews",
      });
    }
  }
);

// POST /api/logs/full → Full-featured log: text, rating, gif, image, favorite character, etc.
router.post("/full",protect,upload.single("image"),async (req, res) => {
    try {
      const {
        movieId,
        review,
        rating,
        rewatch,
        rewatchCount,
        gif,
        watchedAt,
        title,
        poster,
        backdrop,
        favoriteCharacter,
      } = req.body;

      const tmdbId =
        parsePositiveInteger(movieId);

      if (!tmdbId) {
        return res.status(400).json({
          message: "Invalid movieId",
        });
      }

      const parsedRating = parseRating(rating);

      if (parsedRating === null) {
        return res.status(400).json({
          message:
            "Rating must be between 0 and 5",
        });
      }

      const parsedRewatchCount =
        parseRewatchCount(rewatchCount);

      if (parsedRewatchCount === null) {
        return res.status(400).json({
          message: "Invalid rewatch count",
        });
      }

      const parsedWatchedAt =
        parseOptionalDate(watchedAt);

      if (!parsedWatchedAt) {
        return res.status(400).json({
          message: "Invalid watched date",
        });
      }

      let movie = await Movie.findOne({
        tmdbId,
      });

      if (!movie) {
        if (!TMDB_API_KEY) {
          return res.status(503).json({
            message:
              "Movie service is unavailable",
          });
        }

        try {
          const tmdbResponse =
            await axios.get(
              `https://api.themoviedb.org/3/movie/${tmdbId}`,
              {
                params: {
                  api_key: TMDB_API_KEY,
                },
                timeout: 10000,
              }
            );

          const tmdbMovie = tmdbResponse.data;

          movie = await Movie.findOneAndUpdate(
            { tmdbId },
            {
              $setOnInsert: {
                tmdbId: tmdbMovie.id,
                title:
                  tmdbMovie.title ||
                  "Untitled",
                posterPath:
                  tmdbMovie.poster_path ||
                  "",
                releaseDate:
                  tmdbMovie.release_date ||
                  null,
                backdropPath:
                  tmdbMovie.backdrop_path ||
                  "",
              },
            },
            {
              new: true,
              upsert: true,
              runValidators: true,
            }
          );
        } catch (fetchError) {
          console.error(
            "❌ TMDB fetch failed:",
            fetchError.message
          );

          return res.status(502).json({
            message:
              "Failed to fetch movie data",
          });
        }
      }

      const uploadedImage = req.file
        ? await uploadToCloudinary(
            req.file.buffer,
            "scene/logs"
          )
        : "";

      const cleanReview = cleanString(
        review,
        10000
      );

      const cleanGif = cleanString(gif, 2000);

      const combinedReview = cleanReview
        ? cleanReview
        : cleanGif || uploadedImage
          ? "__media__"
          : "";

      const newLog = await Log.create({
        user: req.user._id,
        tmdbId: movie.tmdbId,

        review: combinedReview,
        rating: parsedRating,

        rewatch:
          parseBooleanValue(rewatch),

        rewatchCount:
          parsedRewatchCount,

        gif: cleanGif,
        image: uploadedImage,

        watchedAt: parsedWatchedAt,

        title:
          cleanString(title, 500) ||
          movie.title ||
          "",

        poster:
          cleanString(poster, 2000) ||
          movie.posterPath ||
          "",

        backdrop:
          cleanString(backdrop, 2000) ||
          movie.backdropPath ||
          "",

        favoriteCharacter:
          cleanFavoriteCharacter(
            favoriteCharacter
          ),

        importedFrom: "manual",
      });

      await synchronizeTotalLogs(
        req.user._id
      );

      return res.status(201).json({
        message:
          "✅ Log saved successfully!",
        log: newLog,
      });
    } catch (error) {
      console.error(
        "❌ Failed to save full log:",
        error
      );

      return res.status(500).json({
        message: "Failed to save full log",
      });
    }
  }
);

// PATCH /api/logs/:logId → Edit an existing log safely
router.patch("/:logId",protect,upload.single("image"),async (req, res) => {
    try {
      if (
        !isValidObjectId(
          req.params.logId
        )
      ) {
        return res.status(400).json({
          message: "Invalid log ID",
        });
      }

      const log = await Log.findById(
        req.params.logId
      );

      if (!log) {
        return res.status(404).json({
          message: "Log not found",
        });
      }

      if (
        !log.user ||
        String(log.user) !==
          String(req.user._id)
      ) {
        return res.status(403).json({
          message: "Unauthorized",
        });
      }

      const {
        review,
        rating,
        rewatch,
        rewatchCount,
        gif,
        watchedAt,
        title,
        poster,
        favoriteCharacter,
      } = req.body;

      if (rating !== undefined) {
        const parsedRating =
          parseRating(rating);

        if (parsedRating === null) {
          return res.status(400).json({
            message:
              "Rating must be between 0 and 5",
          });
        }

        log.rating = parsedRating;
      }

      if (rewatchCount !== undefined) {
        const parsedRewatchCount =
          parseRewatchCount(
            rewatchCount
          );

        if (
          parsedRewatchCount === null
        ) {
          return res.status(400).json({
            message:
              "Invalid rewatch count",
          });
        }

        log.rewatchCount =
          parsedRewatchCount;
      }

      if (watchedAt !== undefined) {
        const parsedWatchedAt =
          parseOptionalDate(watchedAt);

        if (!parsedWatchedAt) {
          return res.status(400).json({
            message:
              "Invalid watched date",
          });
        }

        log.watchedAt =
          parsedWatchedAt;
      }

      if (review !== undefined) {
        log.review = cleanString(
          review,
          10000
        );
      }

      if (rewatch !== undefined) {
        log.rewatch =
          parseBooleanValue(rewatch);
      }

      if (gif !== undefined) {
        log.gif = cleanString(
          gif,
          2000
        );
      }

      if (title !== undefined) {
        log.title = cleanString(
          title,
          500
        );
      }

      if (
        poster !== undefined &&
        poster !== "undefined"
      ) {
        log.poster = cleanString(
          poster,
          2000
        );
      }

      if (req.file) {
        log.image =
          await uploadToCloudinary(
            req.file.buffer,
            "scene/logs"
          );
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "favoriteCharacter"
        )
      ) {
        log.favoriteCharacter =
          cleanFavoriteCharacter(
            favoriteCharacter
          );
      }

      await log.save();

      return res.json({
        message: "✅ Log updated",
        log,
      });
    } catch (error) {
      console.error(
        "❌ PATCH log failed:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to update log",
      });
    }
  }
);

// GET /api/logs/feed — Get logs from user + following
router.get("/feed/:id",protect,async (req, res) => {
    try {
      if (
        !isValidObjectId(req.params.id)
      ) {
        return res.status(400).json({
          message: "Invalid user ID",
        });
      }

      /*
       * Keep :id for frontend compatibility,
       * but never allow someone to construct
       * a feed from another user's follows.
       */
      if (
        String(req.params.id) !==
        String(req.user._id)
      ) {
        return res.status(403).json({
          message:
            "You can only access your own feed",
        });
      }

      const currentUser =
        await User.findById(
          req.user._id
        )
          .select("following")
          .lean();

      if (!currentUser) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      const feedUserIds = [
        req.user._id,
        ...(currentUser.following || []),
      ];

      const {
        limit,
        skip,
      } = parsePagination(
        req.query,
        60,
        100
      );

      const logs = await Log.find({
        user: { $in: feedUserIds },
      })
        .populate(
          "user",
          "username avatar"
        )
        .sort({
          createdAt: -1,
          _id: -1,
        })
        .skip(skip)
        .limit(limit)
        .lean();

      const tmdbIds = logs
        .map(getLogTmdbId)
        .filter(Boolean);

      const [
        movieMetadataMap,
        customPosterMap,
      ] = await Promise.all([
        getMovieMetadataMap(tmdbIds),

        getCustomPosterMap(
          req.user._id,
          tmdbIds
        ),
      ]);

      const formattedLogs = logs
        .map((log) => {
          const tmdbId =
            getLogTmdbId(log);

          return formatRetrievedLog({
            log,

            movieMetadata:
              movieMetadataMap.get(
                tmdbId
              ),

            customPosterUrl:
              customPosterMap.get(
                tmdbId
              ),
          });
        })
        .filter(Boolean);

      return res.json(formattedLogs);
    } catch (error) {
      console.error(
        "🔥 Error fetching feed:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to fetch feed",
      });
    }
  }
);

// PATCH /api/logs/:logId/backdrop → Update custom backdrop
router.patch("/:logId/backdrop",protect,async (req, res) => {
    try {
      const { logId } = req.params;

      if (!isValidObjectId(logId)) {
        return res.status(400).json({
          message: "Invalid log ID",
        });
      }

      const backdrop = cleanString(
        req.body?.backdrop,
        2000
      );

      const log = await Log.findOne({
        _id: logId,
        user: req.user._id,
      });

      if (!log) {
        const exists = await Log.exists({
          _id: logId,
        });

        return res
          .status(exists ? 403 : 404)
          .json({
            message: exists
              ? "Unauthorized"
              : "Log not found",
          });
      }

      log.customBackdrop = backdrop;
      await log.save();

      return res.json({
        message: "Backdrop updated",
        customBackdrop:
          log.customBackdrop || "",
      });
    } catch (error) {
      console.error(
        "🔥 Error updating backdrop:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to update backdrop",
      });
    }
  }
);


router.delete("/:logId/replies/:replyId",protect,async (req, res) => {
    try {
      const { logId, replyId } = req.params;

      if (
        !isValidObjectId(logId) ||
        !isValidObjectId(replyId)
      ) {
        return res.status(400).json({
          message: "Invalid log or reply ID",
        });
      }

      const log = await Log.findById(logId)
        .select("user replies");

      if (!log) {
        return res.status(404).json({
          message: "Log not found",
        });
      }

      const reply = log.replies.id(replyId);

      if (!reply) {
        return res.status(404).json({
          message: "Reply not found",
        });
      }

      const currentUserId = String(
        req.user._id
      );

      const replyOwnerId = String(
        reply.user?._id ||
          reply.user ||
          ""
      );

      const logOwnerId = String(
        log.user?._id ||
          log.user ||
          ""
      );

      const isReplyOwner =
        currentUserId === replyOwnerId;

      const isLogOwner =
        currentUserId === logOwnerId;

      if (!isReplyOwner && !isLogOwner) {
        return res.status(403).json({
          message:
            "Not authorized to delete this reply",
        });
      }

      const result = await Log.updateOne(
        {
          _id: logId,
          "replies._id": replyId,
        },
        {
          $pull: {
            replies: {
              _id: replyId,
            },
          },
        }
      );

      if (!result.modifiedCount) {
        return res.status(409).json({
          message:
            "Reply could not be deleted",
        });
      }

      return res.json({
        success: true,
        message: "Reply deleted",
        replyId,
      });
    } catch (error) {
      console.error(
        "❌ Failed to delete reply:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to delete reply",
      });
    }
  }
);


router.delete("/:logId",protect,async (req, res) => {
    try {
      if (
        !isValidObjectId(
          req.params.logId
        )
      ) {
        return res.status(400).json({
          message: "Invalid log ID",
        });
      }

      const deletedLog =
        await Log.findOneAndDelete({
          _id: req.params.logId,
          user: req.user._id,
        });

      if (!deletedLog) {
        const exists =
          await Log.exists({
            _id: req.params.logId,
          });

        return res
          .status(exists ? 403 : 404)
          .json({
            message: exists
              ? "Not authorized to delete this log"
              : "Log not found",
          });
      }

      await Notification.deleteMany({
        $or: [
          {
            relatedId:
              deletedLog._id,
          },
          {
            reviewId:
              deletedLog._id,
          },
        ],
      });

      const totalLogs =
        await synchronizeTotalLogs(
          req.user._id
        );

      return res.json({
        message:
          "✅ Log deleted successfully!",
        totalLogs,
      });
    } catch (error) {
      console.error(
        "🔥 Error deleting log:",
        error
      );

      return res.status(500).json({
        message:
          "Server error deleting log",
      });
    }
  }
);

router.get("/user/:userId",protect,async (req, res) => {
    try {
      const profileUserId =
        req.params.userId;

      if (
        !isValidObjectId(
          profileUserId
        )
      ) {
        return res.status(400).json({
          message: "Invalid user ID",
        });
      }

      const profileExists =
        await User.exists({
          _id: profileUserId,
        });

      if (!profileExists) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      const {
        limit,
        skip,
      } = parsePagination(
        req.query,
        60,
        100
      );

      const logs = await Log.find({
        user: profileUserId,
      })
        .populate(
          "user",
          "username avatar"
        )
        .populate(
          "replies.user",
          "username avatar"
        )
        .sort({
          createdAt: -1,
          _id: -1,
        })
        .skip(skip)
        .limit(limit)
        .lean();

      const tmdbIds = logs
        .map(getLogTmdbId)
        .filter(Boolean);

      /*
       * A profile displays the poster
       * choices made by that profile owner,
       * matching the existing behavior.
       */
      const [
        movieMetadataMap,
        customPosterMap,
      ] = await Promise.all([
        getMovieMetadataMap(tmdbIds),

        getCustomPosterMap(
          profileUserId,
          tmdbIds
        ),
      ]);

      const formattedLogs = logs
        .map((log) => {
          const tmdbId =
            getLogTmdbId(log);

          return formatRetrievedLog({
            log,

            movieMetadata:
              movieMetadataMap.get(
                tmdbId
              ),

            customPosterUrl:
              customPosterMap.get(
                tmdbId
              ),
          });
        })
        .filter(Boolean);

      return res.json(formattedLogs);
    } catch (error) {
      console.error(
        "🔥 Failed to fetch user logs:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to fetch user logs",
      });
    }
  }
);

router.post("/:id/share",protect,async (req, res) => {
    try {
      const logId = req.params.id;
      const { recipients } = req.body;

      if (!isValidObjectId(logId)) {
        return res.status(400).json({
          message: "Invalid review ID",
        });
      }

      if (!Array.isArray(recipients)) {
        return res.status(400).json({
          message: "Recipients must be an array",
        });
      }

      const uniqueRecipientIds = [
        ...new Set(
          recipients
            .map((recipientId) =>
              String(recipientId || "").trim()
            )
            .filter(
              (recipientId) =>
                isValidObjectId(recipientId) &&
                recipientId !==
                  String(req.user._id)
            )
        ),
      ].slice(0, 25);

      if (!uniqueRecipientIds.length) {
        return res.status(400).json({
          message:
            "At least one valid recipient is required",
        });
      }

      const log = await Log.findById(logId)
        .select("_id tmdbId movie");

      if (!log) {
        return res.status(404).json({
          message: "Review not found",
        });
      }

      const validUsers = await User.find({
        _id: {
          $in: uniqueRecipientIds,
        },
      })
        .select("_id")
        .lean();

      const validRecipientIds = validUsers.map(
        (user) => user._id
      );

      if (!validRecipientIds.length) {
        return res.status(404).json({
          message:
            "No valid recipients were found",
        });
      }

      const fromUser = await User.findById(
        req.user._id
      )
        .select("username avatar")
        .lean();

      const movieId =
        log.tmdbId ||
        log.movie?.tmdbId ||
        log.movie?.id ||
        (
          typeof log.movie === "number"
            ? log.movie
            : null
        );

      const notifications =
        await Notification.insertMany(
          validRecipientIds.map(
            (recipientId) => ({
              type: "share-review",
              message:
                "suggested you to check out this review!",
              from: req.user._id,
              to: recipientId,
              reviewId: log._id,
              relatedId: log._id,
              movieId: movieId || null,
              read: false,
            })
          )
        );

      const io = req.app.get("io");

      notifications.forEach(
        (notification) => {
          io
            ?.to(String(notification.to))
            .emit("notification", {
              ...notification.toObject(),
              from: fromUser,
            });
        }
      );

      return res.json({
        success: true,
        sentCount: notifications.length,
      });
    } catch (error) {
      console.error(
        "❌ Failed to share review:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to share review",
      });
    }
  }
);

router.post("/:logId/replies/:replyId/like",protect,async (req, res) => {
    try {
      const { logId, replyId } = req.params;

      if (
        !isValidObjectId(logId) ||
        !isValidObjectId(replyId)
      ) {
        return res.status(400).json({
          message: "Invalid log or reply ID",
        });
      }

      const log = await Log.findById(logId);

      if (!log) {
        return res.status(404).json({
          message: "Log not found",
        });
      }

      const reply = log.replies.id(replyId);

      if (!reply) {
        return res.status(404).json({
          message: "Reply not found",
        });
      }

      if (!Array.isArray(reply.likes)) {
        reply.likes = [];
      }

      const userId = req.user._id;

      const alreadyLiked = reply.likes.some(
        (id) => String(id) === String(userId)
      );

      if (alreadyLiked) {
        reply.likes = reply.likes.filter(
          (id) => String(id) !== String(userId)
        );
      } else {
        reply.likes.push(userId);
      }

      await log.save();

      const replyOwnerId =
        reply.user?._id || reply.user;

      if (
        !alreadyLiked &&
        replyOwnerId &&
        String(replyOwnerId) !== String(userId)
      ) {
        const fromUser = await User.findById(userId)
          .select("username avatar")
          .lean();

        const notification =
          await Notification.create({
            type: "reaction",
            message: "liked your comment",
            from: userId,
            to: replyOwnerId,
            relatedId: log._id,
            read: false,
          });

        const io = req.app.get("io");

        io
          ?.to(String(replyOwnerId))
          .emit("notification", {
            ...notification.toObject(),
            from: fromUser,
          });
      }

      return res.json({
        liked: !alreadyLiked,
        likesCount: reply.likes.length,
      });
    } catch (error) {
      console.error(
        "❌ Failed to like/unlike reply:",
        error
      );

      return res.status(500).json({
        message: "Failed to like/unlike reply",
      });
    }
  }
);

router.get("/user/:userId/movie/:movieId",async (req, res) => {
    try {
      const {
        userId,
        movieId,
      } = req.params;

      if (!isValidObjectId(userId)) {
        return res.status(400).json({
          message: "Invalid user ID",
        });
      }

      const tmdbId =
        parsePositiveInteger(movieId);

      if (!tmdbId) {
        return res.status(400).json({
          message: "Invalid movie ID",
        });
      }

      const logs = await Log.find({
        user: userId,
        tmdbId,
      })
        .populate(
          "user",
          "username avatar"
        )
        .populate(
          "replies.user",
          "username avatar"
        )
        .sort({
          createdAt: -1,
          _id: -1,
        })
        .limit(100)
        .lean();

      return res.json(logs);
    } catch (error) {
      console.error(
        "🔥 Failed to fetch user/movie logs:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to fetch logs for user/movie",
      });
    }
  }
);


// GET /api/logs/:filterType → Logs by time filter
router.patch("/:logId/backdrop",protect,async (req, res) => {
    try {
      const { logId } = req.params;

      if (!isValidObjectId(logId)) {
        return res.status(400).json({
          message: "Invalid log ID",
        });
      }

      const backdrop = cleanString(
        req.body?.backdrop,
        2000
      );

      const log = await Log.findOne({
        _id: logId,
        user: req.user._id,
      });

      if (!log) {
        const exists = await Log.exists({
          _id: logId,
        });

        return res
          .status(exists ? 403 : 404)
          .json({
            message: exists
              ? "Unauthorized"
              : "Log not found",
          });
      }

      log.customBackdrop = backdrop;
      await log.save();

      return res.json({
        message: "Backdrop updated",
        customBackdrop:
          log.customBackdrop || "",
      });
    } catch (error) {
      console.error(
        "🔥 Error updating backdrop:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to update backdrop",
      });
    }
  }
);

// Handle upload and route errors consistently.
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        message: "Image must be 8 MB or smaller",
      });
    }

    return res.status(400).json({
      message: "Invalid image upload",
    });
  }

  if (error) {
    console.error(
      "❌ Unhandled log route error:",
      error
    );

    return res.status(500).json({
      message: "Log request failed",
    });
  }

  return next();
});


module.exports = router;
