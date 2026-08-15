// src/routes/tvProfileRoutes.js

const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const User = require("../models/user");

const TVLog = require("../models/tvLog");

const ShowReview = require("../models/showReview");

const UserShowProgress = require("../models/userShowProgress");

const CustomShowPoster = require("../models/customShowPoster");

const ShowFavoriteCharacter = require("../models/showFavouriteCharacter");

const { getTVProfileStats } = require("../services/tvStatsService");

// ======================================================
// Constants
// ======================================================

const DEFAULT_LIMIT = 20;
const MAXIMUM_LIMIT = 50;

const VALID_SHOW_STATUSES = new Set(["watching", "completed"]);

const VALID_SHOW_SORTS = new Set([
  "recent",
  "progress",
  "runtime",
  "rewatches",
]);

// ======================================================
// Helpers
// ======================================================

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseLimit(value, fallback = DEFAULT_LIMIT) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, MAXIMUM_LIMIT);
}

function parsePage(value) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return 1;
  }

  return parsed;
}

function normalizeStatus(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return VALID_SHOW_STATUSES.has(normalized) ? normalized : null;
}

function normalizeSort(value) {
  if (typeof value !== "string") {
    return "recent";
  }

  const normalized = value.trim().toLowerCase();

  return VALID_SHOW_SORTS.has(normalized) ? normalized : "recent";
}

function hasReviewContent(log) {
  return Boolean(
    (typeof log?.review === "string" && log.review.trim()) ||
    (typeof log?.gif === "string" && log.gif.trim()) ||
    (typeof log?.image === "string" && log.image.trim()) ||
    (Array.isArray(log?.images) &&
      log.images.some((value) => typeof value === "string" && value.trim())),
  );
}

function getReviewMatch() {
  return {
    $or: [
      {
        review: {
          $type: "string",

          $ne: "",
        },
      },

      {
        gif: {
          $type: "string",

          $ne: "",
        },
      },

      {
        image: {
          $type: "string",

          $ne: "",
        },
      },

      {
        "images.0": {
          $exists: true,
        },
      },
    ],
  };
}

function getFavoriteCharacterTag(favoriteCharacter) {
  const characterName = favoriteCharacter?.characterName;

  if (typeof characterName !== "string" || !characterName.trim()) {
    return null;
  }

  const fullName = characterName
    .split(/[\\/|,]/)[0]
    .trim()
    .replace(/[^a-zA-Z0-9\u0600-\u06FF]+/g, "");

  return fullName ? `#Team${fullName}` : null;
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
    watchedAt: log.watchedAt || log.createdAt || null,

    createdAt: log.createdAt || log.watchedAt || null,

    id: String(log._id),
  };

  if (
    !payload.watchedAt ||
    !payload.createdAt ||
    !mongoose.isValidObjectId(payload.id)
  ) {
    return null;
  }

  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const normalized = value.trim();

  try {
    const decoded = Buffer.from(normalized, "base64url").toString("utf8");

    const payload = JSON.parse(decoded);

    const watchedAt = new Date(payload.watchedAt);

    const createdAt = new Date(payload.createdAt);

    if (
      !Number.isNaN(watchedAt.getTime()) &&
      !Number.isNaN(createdAt.getTime()) &&
      mongoose.isValidObjectId(payload.id)
    ) {
      return {
        watchedAt,
        createdAt,

        id: new mongoose.Types.ObjectId(payload.id),

        legacy: false,
      };
    }
  } catch (error) {
    // Continue to legacy ISO cursor support.
  }

  const legacyDate = new Date(normalized);

  if (Number.isNaN(legacyDate.getTime())) {
    return null;
  }

  return {
    watchedAt: legacyDate,

    createdAt: null,

    id: null,

    legacy: true,
  };
}

function buildCursorMatch(cursor) {
  if (!cursor) {
    return null;
  }

  if (cursor.legacy || !cursor.createdAt || !cursor.id) {
    return {
      watchedAt: {
        $lt: cursor.watchedAt,
      },
    };
  }

  return {
    $or: [
      {
        watchedAt: {
          $lt: cursor.watchedAt,
        },
      },

      {
        watchedAt: cursor.watchedAt,

        createdAt: {
          $lt: cursor.createdAt,
        },
      },

      {
        watchedAt: cursor.watchedAt,

        createdAt: cursor.createdAt,

        _id: {
          $lt: cursor.id,
        },
      },
    ],
  };
}

function getShowSort(sortType) {
  if (sortType === "progress") {
    return {
      progressPercentage: -1,

      watchedEpisodeCount: -1,

      lastWatchedAt: -1,

      _id: -1,
    };
  }

  if (sortType === "runtime") {
    return {
      totalWatchMinutes: -1,

      lastWatchedAt: -1,

      _id: -1,
    };
  }

  if (sortType === "rewatches") {
    return {
      rewatchCount: -1,

      totalWatchCount: -1,

      lastWatchedAt: -1,

      _id: -1,
    };
  }

  return {
    lastWatchedAt: -1,

    updatedAt: -1,

    _id: -1,
  };
}

async function findUserByUsername(username) {
  if (typeof username !== "string" || !username.trim()) {
    return null;
  }

  const cleanUsername = username.trim();

  return User.findOne({
    username: {
      $regex: `^${escapeRegex(cleanUsername)}$`,

      $options: "i",
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
      ].join(" "),
    )
    .lean({
      virtuals: true,
    });
}

function serializeProfileUser(user) {
  return {
    id: String(user._id),

    username: user.username || "",

    name: user.name || "",

    bio: user.bio || "",

    avatar: user.avatar || "",

    language: user.language || "en",

    preferredMode: user.preferredMode || "movies",

    tvProfileBackdrop: user.tvProfileBackdrop || "",

    favoriteShows: Array.isArray(user.favoriteShows)
      ? user.favoriteShows.slice(0, 8)
      : [],

    social: {
      followerCount: Array.isArray(user.followers) ? user.followers.length : 0,

      followingCount: Array.isArray(user.following) ? user.following.length : 0,
    },

    joinedAt: user.createdAt || null,
  };
}

function serializeShowProgress(progress) {
  const nextEpisode =
    progress.nextUnwatchedEpisode ||
    progress.nextEpisodeAfterLatestLog ||
    null;

  return {
    id: String(progress._id),

    show: {
      id: progress.show ? String(progress.show) : null,

      tmdbId: progress.showTmdbId,

      name: progress.showName || "",

      nameAr: progress.showNameAr || "",

      posterPath: progress.posterPath || "",

      backdropPath: progress.backdropPath || "",

      firstAirDate: progress.firstAirDate || null,
    },

    progress: {
      status: progress.status || "watching",

      percentage: Number(progress.progressPercentage) || 0,

      watchedEpisodeCount: Number(progress.watchedEpisodeCount) || 0,

      watchedSpecialCount: Number(progress.watchedSpecialCount) || 0,

      airedEpisodeCount: Number(progress.airedEpisodeCount) || 0,

      totalEpisodeCount: Number(progress.totalEpisodeCount) || 0,

      completedSeasonCount: Number(progress.completedSeasonCount) || 0,

      airedSeasonCount: Number(progress.airedSeasonCount) || 0,

      isCaughtUp: Boolean(progress.isCaughtUp),
    },

    watches: {
      total: Number(progress.totalWatchCount) || 0,

      rewatches: Number(progress.rewatchCount) || 0,

      minutes: Number(progress.totalWatchMinutes) || 0,
    },

    latest: {
      logId: progress.lastLog ? String(progress.lastLog) : null,

      watchedAt: progress.lastWatchedAt || null,

      seasonNumber: progress.lastSeasonNumber ?? null,

      episodeNumber: progress.lastEpisodeNumber ?? null,

      episodeTmdbId: progress.lastEpisodeTmdbId ?? null,

      episodeName: progress.lastEpisodeName || "",

      episodeStillPath: progress.lastEpisodeStillPath || "",

      watchNumber: Number(progress.lastWatchNumber) || 1,

      rewatch: Boolean(progress.lastWasRewatch),
    },

    nextUnwatchedEpisode:
      progress.nextUnwatchedEpisode || null,

    nextEpisodeAfterLatestLog:
      progress.nextEpisodeAfterLatestLog || null,

    nextEpisode,

    nextScheduledEpisode:
      progress.nextScheduledEpisode || null,

    startedAt: progress.startedAt || null,

    firstCompletedAt: progress.firstCompletedAt || null,

    navigation: {
      show: {
        screen: "Show",

        params: {
          showTmdbId: progress.showTmdbId,
        },
      },

      nextEpisode: nextEpisode
        ? {
            screen: "Episode",

            params: {
              showTmdbId: progress.showTmdbId,

              seasonNumber: nextEpisode.seasonNumber,

              episodeNumber: nextEpisode.episodeNumber,

              episodeTmdbId: nextEpisode.episodeTmdbId ?? null,
            },
          }
        : null,
    },
  };
}

function serializeReview(log) {
  const displayBackdrop =
    log.customEpisodeBackdrop || log.episodeStillPath || log.showBackdrop || "";

  const displayPoster = log.customShowPoster || log.showPoster || "";

  return {
    id: String(log._id),

    navigation: {
      screen: "EpisodeReview",

      params: {
        logId: String(log._id),

        showTmdbId: log.showTmdbId,

        seasonNumber: log.seasonNumber,

        episodeNumber: log.episodeNumber,

        episodeTmdbId: log.episodeTmdbId ?? null,
      },
    },

    show: {
      id: log.show ? String(log.show) : null,

      tmdbId: log.showTmdbId,

      name: log.showName || "",

      posterPath: log.showPoster || "",

      backdropPath: log.showBackdrop || "",

      displayPoster,
    },

    episode: {
      tmdbId: log.episodeTmdbId ?? null,

      seasonNumber: log.seasonNumber,

      episodeNumber: log.episodeNumber,

      code: `S${log.seasonNumber}E${log.episodeNumber}`,

      name: log.episodeName || "",

      stillPath: log.episodeStillPath || "",

      runtime: log.episodeRuntime ?? null,

      displayBackdrop,
    },

    review: {
      text: log.review || "",

      rating: log.rating ?? null,

      containsSpoilers: Boolean(log.containsSpoilers),

      gif: log.gif || "",

      image: log.image || "",

      images: Array.isArray(log.images)
        ? log.images.filter(
            (value) => typeof value === "string" && value.trim(),
          )
        : [],
    },

    activity: {
      watchedAt: log.watchedAt,

      createdAt: log.createdAt,

      watchNumber: Number(log.watchNumber) || 1,

      rewatch: Boolean(log.rewatch),
    },

    favoriteCharacter: log.favoriteCharacter || null,

    favoriteCharacterTag: getFavoriteCharacterTag(log.favoriteCharacter),

    engagement: {
      likeCount: Array.isArray(log.likes) ? log.likes.length : 0,

      replyCount: Array.isArray(log.replies) ? log.replies.length : 0,
    },
  };
}

function serializeProfileActivity(log, user) {
  const hasReview = hasReviewContent(log);

  const displayBackdrop =
    log.customEpisodeBackdrop || log.episodeStillPath || log.showBackdrop || "";

  const displayPoster = log.customShowPoster || log.showPoster || "";

  return {
    id: String(log._id),

    type: hasReview ? "episode_review" : "episode_log",

    user: {
      id: user?._id ? String(user._id) : String(log.user),

      username: user?.username || "",

      name: user?.name || "",

      avatar: user?.avatar || "",
    },

    show: {
      id: log.show ? String(log.show) : null,

      tmdbId: log.showTmdbId,

      name: log.showName || "",

      posterPath: log.showPoster || "",

      backdropPath: log.showBackdrop || "",

      displayPoster,
    },

    episode: {
      tmdbId: log.episodeTmdbId ?? null,

      seasonNumber: log.seasonNumber,

      episodeNumber: log.episodeNumber,

      code: `S${String(log.seasonNumber).padStart(2, "0")}E${String(
        log.episodeNumber,
      ).padStart(2, "0")}`,

      name: log.episodeName || "",

      runtime: log.episodeRuntime ?? null,

      stillPath: log.episodeStillPath || "",

      displayBackdrop,
    },

    activity: {
      watchedAt: log.watchedAt || log.createdAt || null,

      createdAt: log.createdAt || null,

      watchNumber: Number(log.watchNumber) || 1,

      rewatch: Boolean(log.rewatch),

      logMethod: log.logMethod || "full",
    },

    review: {
      hasReview,

      text: log.review || "",

      rating: log.rating ?? null,

      containsSpoilers: Boolean(log.containsSpoilers),

      gif: log.gif || "",

      image: log.image || "",

      images: Array.isArray(log.images) ? log.images.filter(Boolean) : [],
    },

    favoriteCharacter: log.favoriteCharacter || null,

    favoriteCharacterTag: getFavoriteCharacterTag(log.favoriteCharacter),

    engagement: {
      likeCount: Array.isArray(log.likes) ? log.likes.length : 0,

      replyCount: Array.isArray(log.replies) ? log.replies.length : 0,
    },

    navigation: {
      screen: hasReview ? "EpisodeReview" : "Episode",

      params: {
        logId: hasReview ? String(log._id) : null,

        showTmdbId: log.showTmdbId,

        seasonNumber: log.seasonNumber,

        episodeNumber: log.episodeNumber,

        episodeTmdbId: log.episodeTmdbId ?? null,
      },
    },
  };
}

function serializeProfileShowReview(
  review,
  customPosterUrl = "",
  favoriteCharacterSelection = null,
) {
  const showTmdbId = Number(review.showTmdbId) || null;

  const posterPath = review.showPoster || "";

  const normalizedCustomPoster = customPosterUrl
    ? String(customPosterUrl).startsWith("http")
      ? customPosterUrl
      : `https://image.tmdb.org/t/p/w500${customPosterUrl}`
    : "";

  const normalPoster = posterPath
    ? String(posterPath).startsWith("http")
      ? posterPath
      : `https://image.tmdb.org/t/p/w500${posterPath}`
    : "";

  const displayPoster = normalizedCustomPoster || normalPoster;

  const favoriteCharacter =
    favoriteCharacterSelection?.character || review.favoriteCharacter || null;

  const favoriteCharacterName =
    favoriteCharacter?.characterName ||
    favoriteCharacter?.name ||
    favoriteCharacter?.character ||
    "";

  const favoriteCharacterTag =
    getFavoriteCharacterTag(favoriteCharacter) ||
    (favoriteCharacterName
      ? `#Team${String(favoriteCharacterName)
          .split(/[\\/|,]/)[0]
          .trim()
          .replace(/\s+/g, "")}`
      : "");

  const displayBackdrop = review.customBackdrop || review.showBackdrop || "";

  const likes = Array.isArray(review.likes) ? review.likes : [];

  const replies = Array.isArray(review.replies) ? review.replies : [];

  return {
    id: String(review._id),

    _id: String(review._id),

    type: "show_review",

    show: {
      id: review.show ? String(review.show) : null,

      tmdbId: showTmdbId,

      name: review.showName || "",

      nameAr: review.showNameAr || "",

      posterPath,

      posterOverride: normalizedCustomPoster,

      customShowPoster: normalizedCustomPoster,

      backdropPath: review.showBackdrop || "",

      displayPoster,

      displayBackdrop,

      firstAirDate: review.firstAirDate || null,
    },

    title: review.showName || "",

    posterOverride: normalizedCustomPoster,

    customShowPoster: normalizedCustomPoster,

    displayPoster,

    rating: review.rating ?? null,

    review: review.review || "",

    containsSpoilers: Boolean(review.containsSpoilers),

    gif: review.gif || "",

    image: review.image || "",

    images: Array.isArray(review.images) ? review.images.filter(Boolean) : [],

    media: {
      gif: review.gif || "",

      image: review.image || "",

      images: Array.isArray(review.images) ? review.images.filter(Boolean) : [],
    },

    favoriteCharacter,

    favoriteCharacterTag,

    teamTag: favoriteCharacterTag,

    teamTag: getFavoriteCharacterTag(review.favoriteCharacter),

    likes,

    likesCount: likes.length,

    replies,

    repliesCount: replies.length,

    engagement: {
      likeCount: likes.length,

      replyCount: replies.length,
    },

    createdAt: review.createdAt || null,

    updatedAt: review.updatedAt || review.createdAt || null,

    watchedAt: review.updatedAt || review.createdAt || null,

    navigation: {
      screen: "ShowReview",

      params: {
        reviewId: String(review._id),

        showTmdbId,
      },
    },
  };
}

function normalizeWatchlist(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(Boolean)
    .slice()
    .sort(
      (first, second) =>
        new Date(second?.addedAt || 0).getTime() -
        new Date(first?.addedAt || 0).getTime(),
    );
}

function handleError(error, res, fallbackMessage) {
  console.error(`❌ ${fallbackMessage}:`, error?.stack || error);

  return res.status(500).json({
    error: fallbackMessage,

    details:
      process.env.NODE_ENV === "production"
        ? undefined
        : error?.message || undefined,
  });
}

// ======================================================
// GET /api/tv-profile/:username/shows
//
// TV Profile → Shows.
// ======================================================

router.get("/:username/shows", async (req, res) => {
  try {
    const user = await findUserByUsername(req.params.username);

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const page = parsePage(req.query.page);

    const limit = parseLimit(req.query.limit);

    const status = normalizeStatus(req.query.status);

    const sortType = normalizeSort(req.query.sort);

    const match = {
      user: user._id,
    };

    if (status) {
      match.status = status;
    }

    const sort = getShowSort(sortType);

    const skip = (page - 1) * limit;

    const [progressDocuments, total] = await Promise.all([
      UserShowProgress.find(match).sort(sort).skip(skip).limit(limit).lean(),

      UserShowProgress.countDocuments(match),
    ]);

    const totalPages = total > 0 ? Math.ceil(total / limit) : 0;

    return res.status(200).json({
      username: user.username,

      results: progressDocuments.map(serializeShowProgress),

      pagination: {
        page,
        limit,
        total,
        totalPages,

        hasMore: page * limit < total,
      },

      filters: {
        status,
        sort: sortType,
      },
    });
  } catch (error) {
    return handleError(error, res, "Failed to fetch profile shows");
  }
});

// ======================================================
// GET /api/tv-profile/:username/show-reviews
//
// TV Profile → Show Reviews.
//
// Query:
// - page=1
// - limit=20
// - sort=recent|likes
// ======================================================

router.get("/:username/show-reviews", async (req, res) => {
  try {
    const user = await findUserByUsername(req.params.username);

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const page = parsePage(req.query.page);

    const limit = parseLimit(req.query.limit);

    const requestedSort =
      typeof req.query.sort === "string"
        ? req.query.sort.trim().toLowerCase()
        : "recent";

    const sortType = requestedSort === "likes" ? "likes" : "recent";

    const skip = (page - 1) * limit;

    const match = {
      user: user._id,
    };

    let reviews = [];
    let total = 0;

    if (sortType === "likes") {
      const results = await ShowReview.aggregate([
        {
          $match: match,
        },

        {
          $addFields: {
            profileLikeCount: {
              $size: {
                $ifNull: ["$likes", []],
              },
            },
          },
        },

        {
          $sort: {
            profileLikeCount: -1,

            updatedAt: -1,

            createdAt: -1,

            _id: -1,
          },
        },

        {
          $facet: {
            results: [
              {
                $skip: skip,
              },

              {
                $limit: limit,
              },
            ],

            count: [
              {
                $count: "total",
              },
            ],
          },
        },
      ]);

      const result = results?.[0] || {};

      reviews = Array.isArray(result.results) ? result.results : [];

      total = Number(result.count?.[0]?.total) || 0;
    } else {
      [reviews, total] = await Promise.all([
        ShowReview.find(match)
          .sort({
            updatedAt: -1,

            createdAt: -1,

            _id: -1,
          })
          .skip(skip)
          .limit(limit)
          .lean({
            virtuals: true,
          }),

        ShowReview.countDocuments(match),
      ]);
    }

    const showTmdbIds = [
      ...new Set(
        reviews
          .map((review) => Number(review.showTmdbId))
          .filter(
            (showTmdbId) => Number.isInteger(showTmdbId) && showTmdbId > 0,
          ),
      ),
    ];

    const customPosterDocuments =
      showTmdbIds.length > 0
        ? await CustomShowPoster.find({
            userId: user._id,

            showId: {
              $in: showTmdbIds,
            },
          })
            .select({
              showId: 1,

              posterUrl: 1,
            })
            .lean()
        : [];

    const customPosterMap = new Map(
      customPosterDocuments.map((poster) => [
        Number(poster.showId),

        poster.posterUrl || "",
      ]),
    );

    const favoriteCharacterDocuments =
      showTmdbIds.length > 0
        ? await ShowFavoriteCharacter.find({
            user: user._id,

            showTmdbId: {
              $in: showTmdbIds,
            },
          })
            .select({
              showTmdbId: 1,
              character: 1,
            })
            .lean()
        : [];

    const favoriteCharacterMap = new Map(
      favoriteCharacterDocuments.map((selection) => [
        Number(selection.showTmdbId),

        selection,
      ]),
    );

    const results = reviews.map((review) => {
      const reviewShowTmdbId = Number(review.showTmdbId);

      return serializeProfileShowReview(
        review,
        customPosterMap.get(reviewShowTmdbId) || "",
        favoriteCharacterMap.get(reviewShowTmdbId) || null,
      );
    });

    const loaded = skip + results.length;

    return res.status(200).json({
      username: user.username,

      type: "show_reviews",

      results,

      count: results.length,

      pagination: {
        page,

        limit,

        total,

        pages: Math.max(1, Math.ceil(total / limit)),

        hasMore: loaded < total,
      },

      hasMore: loaded < total,

      nextPage: loaded < total ? page + 1 : null,

      sort: sortType,
    });
  } catch (error) {
    return handleError(error, res, "Failed to fetch profile show reviews");
  }
});

// ======================================================
// GET /api/tv-profile/:username/reviews
//
// TV Profile → Episode Reviews.
// ======================================================

router.get("/:username/reviews", async (req, res) => {
  try {
    const user = await findUserByUsername(req.params.username);

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const limit = parseLimit(req.query.limit);

    const cursor = decodeCursor(req.query.cursor);

    const match = {
      user: user._id,

      ...getReviewMatch(),
    };

    const cursorMatch = buildCursorMatch(cursor);

    if (cursorMatch) {
      const reviewConditions = match.$or;

      delete match.$or;

      match.$and = [
        {
          $or: reviewConditions,
        },

        cursorMatch,
      ];
    }

    const logs = await TVLog.find(match)
      .sort({
        watchedAt: -1,

        createdAt: -1,

        _id: -1,
      })
      .limit(limit + 1)
      .lean({
        virtuals: true,
      });

    const hasMore = logs.length > limit;

    const visibleLogs = hasMore ? logs.slice(0, limit) : logs;

    const results = visibleLogs.filter(hasReviewContent).map(serializeReview);

    const lastLog = visibleLogs[visibleLogs.length - 1];

    return res.status(200).json({
      username: user.username,

      results,

      count: results.length,

      hasMore,

      nextCursor: hasMore && lastLog ? encodeCursor(lastLog) : null,
    });
  } catch (error) {
    return handleError(error, res, "Failed to fetch profile TV reviews");
  }
});

// ======================================================
// GET /api/tv-profile/:username/watchlist
//
// TV Profile → Watchlist.
// ======================================================

router.get("/:username/watchlist", async (req, res) => {
  try {
    const user = await findUserByUsername(req.params.username);

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const page = parsePage(req.query.page);

    const limit = parseLimit(req.query.limit);

    const watchlist = normalizeWatchlist(user.tvWatchlist);

    const start = (page - 1) * limit;

    const results = watchlist.slice(start, start + limit);

    const total = watchlist.length;

    const totalPages = total > 0 ? Math.ceil(total / limit) : 0;

    return res.status(200).json({
      username: user.username,

      results,

      pagination: {
        page,
        limit,
        total,
        totalPages,

        hasMore: start + limit < total,
      },
    });
  } catch (error) {
    return handleError(error, res, "Failed to fetch TV watchlist");
  }
});

// ======================================================
// GET /api/tv-profile/:username/top-four
// ======================================================

router.get("/:username/top-four", async (req, res) => {
  try {
    const user = await findUserByUsername(req.params.username);

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    return res.status(200).json({
      username: user.username,

      backdrop: user.tvProfileBackdrop || "",

      favoriteShows: Array.isArray(user.favoriteShows)
        ? user.favoriteShows.slice(0, 8)
        : [],
    });
  } catch (error) {
    return handleError(error, res, "Failed to fetch TV Top Four");
  }
});

// ======================================================
// GET /api/tv-profile/:username
//
// Complete TV profile overview.
// Keep the generic username route after all specific routes.
// ======================================================

router.get("/:username", async (req, res) => {
  try {
    const user = await findUserByUsername(req.params.username);

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const reviewMatch = {
      user: user._id,

      ...getReviewMatch(),
    };

    const [
      stats,
      recentShows,
      recentReviews,
      recentActivityLogs,
      favoriteCharacterResults,
    ] = await Promise.all([
      getTVProfileStats(user._id),

      UserShowProgress.find({
        user: user._id,
      })
        .sort({
          lastWatchedAt: -1,

          updatedAt: -1,

          _id: -1,
        })
        .limit(10)
        .lean(),

      TVLog.find(reviewMatch)
        .sort({
          watchedAt: -1,

          createdAt: -1,

          _id: -1,
        })
        .limit(6)
        .lean({
          virtuals: true,
        }),

      TVLog.aggregate([
        {
          $match: {
            user: user._id,
          },
        },

        {
          $sort: {
            watchedAt: -1,

            createdAt: -1,

            _id: -1,
          },
        },

        {
          $group: {
            _id: {
              showTmdbId: "$showTmdbId",

              seasonNumber: "$seasonNumber",

              episodeNumber: "$episodeNumber",
            },

            latestLog: {
              $first: "$$ROOT",
            },
          },
        },

        {
          $replaceRoot: {
            newRoot: "$latestLog",
          },
        },

        {
          $sort: {
            watchedAt: -1,

            createdAt: -1,

            _id: -1,
          },
        },

        {
          $limit: 4,
        },
      ]),

      TVLog.aggregate([
        {
          $match: {
            user: user._id,

            "favoriteCharacter.characterName": {
              $type: "string",

              $ne: "",
            },
          },
        },

        {
          $group: {
            _id: {
              actorId: "$favoriteCharacter.actorId",

              characterName: "$favoriteCharacter.characterName",

              actorName: "$favoriteCharacter.actorName",

              profilePath: "$favoriteCharacter.profilePath",

              showTmdbId: "$showTmdbId",

              showName: "$showName",
            },

            pickCount: {
              $sum: 1,
            },

            latestPickAt: {
              $max: "$watchedAt",
            },
          },
        },

        {
          $sort: {
            pickCount: -1,

            latestPickAt: -1,
          },
        },

        {
          $limit: 1,
        },
      ]),
    ]);

    const favoriteCharacterResult = favoriteCharacterResults?.[0] || null;

    const mostPickedFavoriteCharacter = favoriteCharacterResult
      ? {
          actorId: favoriteCharacterResult?._id?.actorId ?? null,

          characterName: favoriteCharacterResult?._id?.characterName || "",

          actorName: favoriteCharacterResult?._id?.actorName || "",

          profilePath: favoriteCharacterResult?._id?.profilePath || "",

          showTmdbId: favoriteCharacterResult?._id?.showTmdbId ?? null,

          showName: favoriteCharacterResult?._id?.showName || "",

          pickCount: Number(favoriteCharacterResult?.pickCount) || 0,
        }
      : null;

    const watchlist = normalizeWatchlist(user.tvWatchlist);

    const topFour = Array.isArray(user.favoriteShows)
      ? user.favoriteShows.slice(0, 8)
      : [];

    return res.status(200).json({
      user: serializeProfileUser(user),

      stats: {
        ...stats,

        mostPickedFavoriteCharacter,
      },

      mostPickedFavoriteCharacter,

      topFour,

      favoriteShows: topFour,

      recentShows: recentShows.map(serializeShowProgress),

      recentReviews: recentReviews
        .filter(hasReviewContent)
        .map(serializeReview),

      recentActivities: recentActivityLogs.map((log) =>
        serializeProfileActivity(log, user),
      ),

      watchlistPreview: watchlist.slice(0, 10),
    });
  } catch (error) {
    return handleError(error, res, "Failed to fetch TV profile");
  }
});

// ======================================================
// Export
// ======================================================

module.exports = router;
