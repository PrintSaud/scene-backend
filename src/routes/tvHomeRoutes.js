// src/routes/tvHomeRoutes.js

const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const protect = require(
  "../middleware/authMiddleware"
);

const User = require(
  "../models/user"
);

const Show = require(
  "../models/showModel"
);

const TVLog = require(
  "../models/tvLog"
);

const HomeBanner = require(
  "../models/HomeBanner"
);

const UserShowProgress = require(
  "../models/userShowProgress"
);

const {
  getTrendingShows,
  syncShowFromTMDB,
} = require(
  "../services/tvMetadataService"
);

const {
  getUserTVProgressSummary,
} = require(
  "../services/tvProgressService"
);

// ======================================================
// Constants
// ======================================================

const DEFAULT_FEED_LIMIT = 12;
const DEFAULT_CONTINUE_LIMIT = 12;
const DEFAULT_TRENDING_LIMIT = 20;

const MAX_FEED_LIMIT = 50;
const MAX_CONTINUE_LIMIT = 50;
const MAX_TRENDING_LIMIT = 50;

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
  fallback,
  maximum = 50
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
    maximum
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

function serializeProgressCard(
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

      airedEpisodeCount:
        Number(
          progress.airedEpisodeCount
        ) || 0,

      totalEpisodeCount:
        Number(
          progress.totalEpisodeCount
        ) || 0,

      totalWatchCount:
        Number(
          progress.totalWatchCount
        ) || 0,

      rewatchCount:
        Number(
          progress.rewatchCount
        ) || 0,

      totalWatchMinutes:
        Number(
          progress.totalWatchMinutes
        ) || 0,

      isCaughtUp:
        Boolean(
          progress.isCaughtUp
        ),
    },

    latestEpisode: {
      logId:
        progress.lastLog
          ? String(
              progress.lastLog
            )
          : null,

      episodeTmdbId:
        progress.lastEpisodeTmdbId ??
        null,

      seasonNumber:
        progress.lastSeasonNumber ??
        null,

      episodeNumber:
        progress.lastEpisodeNumber ??
        null,

      name:
        progress.lastEpisodeName ||
        "",

      stillPath:
        progress.lastEpisodeStillPath ||
        "",

      watchedAt:
        progress.lastWatchedAt ||
        null,

      watchNumber:
        Number(
          progress.lastWatchNumber
        ) || 1,

      rewatch:
        Boolean(
          progress.lastWasRewatch
        ),
    },

    nextEpisode,

    nextScheduledEpisode:
      progress.nextScheduledEpisode ||
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

function serializeFeedCard(
  log,
  user,
  viewerUserId
) {
  const hasReview =
    hasReviewContent(log);

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

      likedByViewer:
        includesObjectId(
          log.likes,
          viewerUserId
        ),
    },

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
  };
}

function serializeTrendingShow(show) {
  const tmdbId =
    show.tmdbId ||
    show.id ||
    null;

  return {
    id:
      show.localId ||
      show._id ||
      null,

    tmdbId,

    name:
      show.name ||
      "",

    nameAr:
      show.nameAr ||
      "",

    originalName:
      show.originalName ||
      show.original_name ||
      "",

    overview:
      show.overview ||
      "",

    overviewAr:
      show.overviewAr ||
      "",

    posterPath:
      show.posterPath ||
      show.poster_path ||
      "",

    backdropPath:
      show.backdropPath ||
      show.backdrop_path ||
      "",

    firstAirDate:
      show.firstAirDate ||
      show.first_air_date ||
      "",

    voteAverage:
      show.voteAverage ??
      show.vote_average ??
      null,

    voteCount:
      show.voteCount ??
      show.vote_count ??
      0,

    popularity:
      Number(
        show.popularity
      ) || 0,

    genreIds:
      show.genreIds ||
      show.genre_ids ||
      [],

    navigation: {
      screen:
        "Show",

      params: {
        showTmdbId:
          tmdbId,
      },
    },
  };
}

function serializeWeeklyShow(show) {
  if (!show) {
    return null;
  }

  return {
    id:
      String(show._id),

    tmdbId:
      show.tmdbId,

    name:
      show.name ||
      "",

    nameAr:
      show.nameAr ||
      "",

    originalName:
      show.originalName ||
      "",

    overview:
      show.overview ||
      "",

    overviewAr:
      show.overviewAr ||
      "",

    tagline:
      show.tagline ||
      "",

    taglineAr:
      show.taglineAr ||
      "",

    posterPath:
      show.posterPath ||
      "",

    backdropPath:
      show.backdropPath ||
      "",

    firstAirDate:
      show.firstAirDate ||
      null,

    status:
      show.status ||
      "",

    voteAverage:
      show.voteAverage ??
      null,

    genres:
      Array.isArray(
        show.genres
      )
        ? show.genres
        : [],

    navigation: {
      screen:
        "Show",

      params: {
        showTmdbId:
          show.tmdbId,
      },
    },
  };
}

function serializeBanner(banner) {
  return {
    id:
      String(banner._id),

    title:
      banner.title ||
      "",

    subtitle:
      banner.subtitle ||
      "",

    designType:
      banner.designType ||
      "text",

    actionType:
      banner.actionType ||
      "none",

    actionValue:
      banner.actionValue ||
      "",

    image:
      banner.image ||
      banner.imageUrl ||
      "",

    backgroundColor:
      banner.backgroundColor ||
      "#111111",

    textColor:
      banner.textColor ||
      "#ffffff",

    buttonText:
      banner.buttonText ||
      "",

    buttonColor:
      banner.buttonColor ||
      "#B327F6",

    buttonTextColor:
      banner.buttonTextColor ||
      "#ffffff",

    mode:
      banner.mode ||
      banner.targetMode ||
      "all",

    priority:
      Number(
        banner.priority
      ) || 0,
  };
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
// Home data helpers
// ======================================================

async function getActiveTVBanners() {
  const now =
    new Date();

  const query = {
    isActive:
      true,

    $and: [
      {
        $or: [
          {
            startsAt: {
              $exists:
                false,
            },
          },
          {
            startsAt:
              null,
          },
          {
            startsAt: {
              $lte:
                now,
            },
          },
        ],
      },

      {
        $or: [
          {
            endsAt: {
              $exists:
                false,
            },
          },
          {
            endsAt:
              null,
          },
          {
            endsAt: {
              $gte:
                now,
            },
          },
        ],
      },

      {
        $or: [
          {
            $and: [
              {
                mode: {
                  $exists:
                    false,
                },
              },
              {
                targetMode: {
                  $exists:
                    false,
                },
              },
            ],
          },

          {
            mode: {
              $in: [
                "all",
                "tv",
              ],
            },
          },

          {
            targetMode: {
              $in: [
                "all",
                "tv",
              ],
            },
          },
        ],
      },
    ],
  };

  return HomeBanner.find(
    query
  )
    .sort({
      priority:
        -1,

      createdAt:
        -1,
    })
    .limit(10)
    .lean();
}

async function getWeeklyShow() {
  let show =
    await Show.findOne({
      $or: [
        {
          isWeeklyShow:
            true,
        },
        {
          weeklyShow:
            true,
        },
        {
          featuredWeekly:
            true,
        },
      ],
    })
      .sort({
        weeklyShowSetAt:
          -1,

        updatedAt:
          -1,
      })
      .lean();

  if (show) {
    return show;
  }

  show =
    await Show.findOne({
      posterPath: {
        $nin: [
          "",
          null,
        ],
      },

      backdropPath: {
        $nin: [
          "",
          null,
        ],
      },

      voteAverage: {
        $gte:
          7,
      },
    })
      .sort({
        popularity:
          -1,

        voteAverage:
          -1,

        updatedAt:
          -1,
      })
      .lean();

  return show;
}

async function getFollowingFeed({
  userId,
  following,
  limit,
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
    mongoose.isValidObjectId(
      userId
    )
  ) {
    uniqueIds.add(
      String(userId)
    );
  }

  if (
    uniqueIds.size === 0
  ) {
    return [];
  }

  const visibleUserIds = [
    ...uniqueIds,
  ].map(
    (value) =>
      new mongoose.Types.ObjectId(
        value
      )
  );

  const logs =
    await TVLog.aggregate([
      {
        $match: {
          user: {
            $in:
              visibleUserIds,
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
          limit,
      },
    ]);

  if (
    logs.length === 0
  ) {
    return [];
  }

  const userIds = [
    ...new Set(
      logs.map(
        (log) =>
          String(
            log.user
          )
      )
    ),
  ];

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

  const userMap =
    new Map(
      users.map(
        (user) => [
          String(
            user._id
          ),
          user,
        ]
      )
    );

  return logs.map(
    (log) =>
      serializeFeedCard(
        log,
        userMap.get(
          String(
            log.user
          )
        ) ||
          null,
        userId
      )
  );
}

async function getTrendingSection(
  limit
) {
  try {
    const trending =
      await getTrendingShows({
        page:
          1,
      });

    const rawResults =
      Array.isArray(
        trending
      )
        ? trending
        : trending?.results ||
          [];

    return rawResults
      .slice(
        0,
        limit
      )
      .map(
        serializeTrendingShow
      );
  } catch (error) {
    console.error(
      "⚠️ Failed to fetch TMDB TV trending:",
      error?.message ||
      error
    );

    const localShows =
      await Show.find({
        posterPath: {
          $nin: [
            "",
            null,
          ],
        },
      })
        .sort({
          popularity:
            -1,

          voteAverage:
            -1,

          updatedAt:
            -1,
        })
        .limit(limit)
        .lean();

    return localShows.map(
      serializeTrendingShow
    );
  }
}

// ======================================================
// GET /api/tv-home/public
//
// Public lightweight TV Home.
// ======================================================

router.get(
  "/public",
  async (req, res) => {
    try {
      const trendingLimit =
        parseLimit(
          req.query
            .trendingLimit,
          DEFAULT_TRENDING_LIMIT,
          MAX_TRENDING_LIMIT
        );

      const [
        banners,
        weeklyShow,
        trending,
      ] = await Promise.all([
        getActiveTVBanners(),

        getWeeklyShow(),

        getTrendingSection(
          trendingLimit
        ),
      ]);

      return res
        .status(200)
        .json({
          mode:
            "tv",

          banners:
            banners.map(
              serializeBanner
            ),

          weeklyShow:
            serializeWeeklyShow(
              weeklyShow
            ),

          trending,

          meta: {
            generatedAt:
              new Date(),

            counts: {
              banners:
                banners.length,

              trending:
                trending.length,
            },
          },
        });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch public TV Home"
      );
    }
  }
);

// ======================================================
// DEVELOPMENT-ONLY WEEKLY SHOW SETTER
//
// This route is deliberately not registered in production.
// A proper administrator middleware should replace it later.
// ======================================================

if (
  process.env.NODE_ENV !==
  "production"
) {
  router.post(
    "/weekly-show/:showTmdbId",
    protect,
    async (req, res) => {
      try {
        const showTmdbId =
          Number(
            req.params
              .showTmdbId
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

        let show =
          await Show.findOne({
            tmdbId:
              showTmdbId,
          });

        if (!show) {
          show =
            await syncShowFromTMDB(
              showTmdbId
            );
        }

        if (!show) {
          return res
            .status(404)
            .json({
              error:
                "Show not found",
            });
        }

        const schemaPaths =
          Show.schema.paths;

        const resetFields = {};

        if (
          schemaPaths
            .isWeeklyShow
        ) {
          resetFields
            .isWeeklyShow =
            false;
        }

        if (
          schemaPaths
            .weeklyShow
        ) {
          resetFields
            .weeklyShow =
            false;
        }

        if (
          schemaPaths
            .featuredWeekly
        ) {
          resetFields
            .featuredWeekly =
            false;
        }

        if (
          Object.keys(
            resetFields
          ).length > 0
        ) {
          await Show.updateMany(
            {},
            {
              $set:
                resetFields,
            }
          );
        }

        if (
          schemaPaths
            .isWeeklyShow
        ) {
          show.isWeeklyShow =
            true;
        }

        if (
          schemaPaths
            .weeklyShow
        ) {
          show.weeklyShow =
            true;
        }

        if (
          schemaPaths
            .featuredWeekly
        ) {
          show.featuredWeekly =
            true;
        }

        if (
          schemaPaths
            .weeklyShowSetAt
        ) {
          show.weeklyShowSetAt =
            new Date();
        }

        await show.save();

        return res
          .status(200)
          .json({
            message:
              "Weekly Show updated",

            weeklyShow:
              serializeWeeklyShow(
                show.toObject()
              ),
          });
      } catch (error) {
        return handleError(
          error,
          res,
          "Failed to update Weekly Show"
        );
      }
    }
  );
}

// ======================================================
// GET /api/tv-home
//
// Complete signed-in TV Home payload.
// ======================================================

router.get(
  "/",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(
          req
        );

      if (
        !mongoose.isValidObjectId(
          userId
        )
      ) {
        return res
          .status(401)
          .json({
            error:
              "Authentication required",
          });
      }

      const continueLimit =
        parseLimit(
          req.query
            .continueLimit,
          DEFAULT_CONTINUE_LIMIT,
          MAX_CONTINUE_LIMIT
        );

      const feedLimit =
        parseLimit(
          req.query
            .feedLimit,
          DEFAULT_FEED_LIMIT,
          MAX_FEED_LIMIT
        );

      const trendingLimit =
        parseLimit(
          req.query
            .trendingLimit,
          DEFAULT_TRENDING_LIMIT,
          MAX_TRENDING_LIMIT
        );

      const includeCaughtUp =
        parseBoolean(
          req.query
            .includeCaughtUp,
          false
        );

      const currentUser =
        await User.findById(
          userId
        )
          .select(
            [
              "username",
              "name",
              "avatar",
              "preferredMode",
              "following",
              "favoriteShows",
              "tvWatchlist",
            ].join(" ")
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

      const continueMatch = {
        user:
          userId,

        nextUnwatchedEpisode: {
          $ne:
            null,
        },
      };

      if (!includeCaughtUp) {
        continueMatch.isCaughtUp =
          false;
      }

      const availableEpisodeMatch = {
        user:
          userId,

        nextUnwatchedEpisode: {
          $ne:
            null,
        },

        "nextUnwatchedEpisode.airDate": {
          $ne:
            null,

          $lte:
            new Date(),
        },
      };

      const [
        banners,
        weeklyShow,
        continueWatching,
        upcomingEpisodes,
        followingActivity,
        trending,
        summary,
      ] = await Promise.all([
        getActiveTVBanners(),

        getWeeklyShow(),

        UserShowProgress.find(
          continueMatch
        )
          .sort({
            lastWatchedAt:
              -1,

            updatedAt:
              -1,
          })
          .limit(
            continueLimit
          )
          .lean(),

        UserShowProgress.find(
          availableEpisodeMatch
        )
          .sort({
            "nextUnwatchedEpisode.airDate":
              1,

            lastWatchedAt:
              -1,
          })
          .limit(
            continueLimit
          )
          .lean(),

        getFollowingFeed({
          userId,

          following:
            currentUser.following,

          limit:
            feedLimit,
        }),

        getTrendingSection(
          trendingLimit
        ),

        getUserTVProgressSummary(
          userId
        ),
      ]);

      return res
        .status(200)
        .json({
          mode:
            "tv",

          user: {
            id:
              String(
                currentUser._id
              ),

            username:
              currentUser.username ||
              "",

            name:
              currentUser.name ||
              "",

            avatar:
              currentUser.avatar ||
              "",

            preferredMode:
              currentUser.preferredMode ||
              "movies",
          },

          banners:
            banners.map(
              serializeBanner
            ),

          weeklyShow:
            serializeWeeklyShow(
              weeklyShow
            ),

          continueWatching:
            continueWatching.map(
              serializeProgressCard
            ),

          upcomingEpisodes:
            upcomingEpisodes.map(
              serializeProgressCard
            ),

          followingActivity,

          trending,

          summary,

          topFour:
            Array.isArray(
              currentUser
                .favoriteShows
            )
              ? currentUser
                  .favoriteShows
              : [],

          watchlistPreview:
            Array.isArray(
              currentUser
                .tvWatchlist
            )
              ? currentUser
                  .tvWatchlist
                  .slice()
                  .sort(
                    (
                      first,
                      second
                    ) =>
                      new Date(
                        second
                          ?.addedAt ||
                          0
                      ).getTime() -
                      new Date(
                        first
                          ?.addedAt ||
                          0
                      ).getTime()
                  )
                  .slice(
                    0,
                    10
                  )
              : [],

          meta: {
            generatedAt:
              new Date(),

            counts: {
              banners:
                banners.length,

              continueWatching:
                continueWatching.length,

              upcomingEpisodes:
                upcomingEpisodes.length,

              followingActivity:
                followingActivity.length,

              trending:
                trending.length,
            },
          },
        });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch TV Home"
      );
    }
  }
);

// ======================================================
// Export
// ======================================================

module.exports = router;

