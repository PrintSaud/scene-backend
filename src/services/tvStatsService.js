// src/services/tvStatsService.js

const mongoose = require("mongoose");

const TVLog = require("../models/tvLog");
const UserShowProgress = require(
  "../models/userShowProgress"
);

// ======================================================
// Helpers
// ======================================================

function validateUserId(userId) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error("Invalid user ID");
  }

  return new mongoose.Types.ObjectId(userId);
}

function normalizeLimit(
  value,
  fallback = 10,
  maximum = 100
) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 1
  ) {
    return fallback;
  }

  return Math.min(parsed, maximum);
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function buildDateMatch({
  startDate,
  endDate,
  field = "watchedAt",
} = {}) {
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate);

  if (!start && !end) {
    return {};
  }

  const range = {};

  if (start) {
    range.$gte = start;
  }

  if (end) {
    range.$lte = end;
  }

  return {
    [field]: range,
  };
}

function minutesToReadableTime(minutes) {
  const safeMinutes = Math.max(
    0,
    Math.floor(Number(minutes) || 0)
  );

  const days = Math.floor(
    safeMinutes / 1440
  );

  const remainingAfterDays =
    safeMinutes % 1440;

  const hours = Math.floor(
    remainingAfterDays / 60
  );

  const remainingMinutes =
    remainingAfterDays % 60;

  return {
    minutes: safeMinutes,
    hours: Math.round(
      (safeMinutes / 60) * 10
    ) / 10,
    days: Math.round(
      (safeMinutes / 1440) * 10
    ) / 10,
    formatted: [
      days > 0 ? `${days}d` : null,
      hours > 0 ? `${hours}h` : null,
      remainingMinutes > 0
        ? `${remainingMinutes}m`
        : null,
    ]
      .filter(Boolean)
      .join(" ") || "0m",
  };
}

function hasReviewContent(log) {
  return Boolean(
    log?.review ||
      log?.gif ||
      log?.image ||
      (
        Array.isArray(log?.images) &&
        log.images.length > 0
      )
  );
}

// ======================================================
// Core profile summary
// ======================================================

async function getTVProfileStats(userId) {
  const objectUserId =
    validateUserId(userId);

  const [
    progressSummary,
    logSummary,
  ] = await Promise.all([
    UserShowProgress.aggregate([
      {
        $match: {
          user: objectUserId,
        },
      },

      {
        $group: {
          _id: null,

          startedShowCount: {
            $sum: 1,
          },

          completedShowCount: {
            $sum: {
              $cond: [
                {
                  $eq: [
                    "$status",
                    "completed",
                  ],
                },
                1,
                0,
              ],
            },
          },

          watchingShowCount: {
            $sum: {
              $cond: [
                {
                  $eq: [
                    "$status",
                    "watching",
                  ],
                },
                1,
                0,
              ],
            },
          },

          uniqueRegularEpisodes: {
            $sum:
              "$watchedEpisodeCount",
          },

          uniqueSpecialEpisodes: {
            $sum:
              "$watchedSpecialCount",
          },

          completedSeasonCount: {
            $sum:
              "$completedSeasonCount",
          },

          totalWatchCount: {
            $sum:
              "$totalWatchCount",
          },

          rewatchCount: {
            $sum:
              "$rewatchCount",
          },

          totalWatchMinutes: {
            $sum:
              "$totalWatchMinutes",
          },
        },
      },
    ]),

    TVLog.aggregate([
      {
        $match: {
          user: objectUserId,
        },
      },

      {
        $group: {
          _id: null,

          ratedLogCount: {
            $sum: {
              $cond: [
                {
                  $ne: [
                    "$rating",
                    null,
                  ],
                },
                1,
                0,
              ],
            },
          },

          ratingTotal: {
            $sum: {
              $cond: [
                {
                  $ne: [
                    "$rating",
                    null,
                  ],
                },
                "$rating",
                0,
              ],
            },
          },

          writtenReviewCount: {
            $sum: {
              $cond: [
                {
                  $gt: [
                    {
                      $strLenCP: {
                        $ifNull: [
                          "$review",
                          "",
                        ],
                      },
                    },
                    0,
                  ],
                },
                1,
                0,
              ],
            },
          },

          likedByOthersCount: {
            $sum: {
              $size: {
                $ifNull: [
                  "$likes",
                  [],
                ],
              },
            },
          },

          commentCount: {
            $sum: {
              $size: {
                $ifNull: [
                  "$replies",
                  [],
                ],
              },
            },
          },
        },
      },
    ]),
  ]);

  const progress =
    progressSummary[0] || {};

  const logs =
    logSummary[0] || {};

  const ratedLogCount =
    Number(logs.ratedLogCount) || 0;

  const ratingTotal =
    Number(logs.ratingTotal) || 0;

  const totalWatchMinutes =
    Number(
      progress.totalWatchMinutes
    ) || 0;

  const uniqueRegularEpisodes =
    Number(
      progress.uniqueRegularEpisodes
    ) || 0;

  const uniqueSpecialEpisodes =
    Number(
      progress.uniqueSpecialEpisodes
    ) || 0;

  return {
    shows: {
      started:
        Number(
          progress.startedShowCount
        ) || 0,

      watching:
        Number(
          progress.watchingShowCount
        ) || 0,

      completed:
        Number(
          progress.completedShowCount
        ) || 0,
    },

    episodes: {
      uniqueRegular:
        uniqueRegularEpisodes,

      uniqueSpecials:
        uniqueSpecialEpisodes,

      uniqueTotal:
        uniqueRegularEpisodes +
        uniqueSpecialEpisodes,

      totalWatches:
        Number(
          progress.totalWatchCount
        ) || 0,

      rewatches:
        Number(
          progress.rewatchCount
        ) || 0,
    },

    seasons: {
      completed:
        Number(
          progress.completedSeasonCount
        ) || 0,
    },

    watchTime:
      minutesToReadableTime(
        totalWatchMinutes
      ),

    ratings: {
      count: ratedLogCount,

      average:
        ratedLogCount > 0
          ? Math.round(
              (
                ratingTotal /
                ratedLogCount
              ) * 100
            ) / 100
          : null,
    },

    reviews: {
      written:
        Number(
          logs.writtenReviewCount
        ) || 0,

      likesReceived:
        Number(
          logs.likedByOthersCount
        ) || 0,

      commentsReceived:
        Number(
          logs.commentCount
        ) || 0,
    },
  };
}

// ======================================================
// Most-watched shows
// ======================================================

async function getMostWatchedShows(
  userId,
  {
    limit = 10,
  } = {}
) {
  const objectUserId =
    validateUserId(userId);

  const safeLimit =
    normalizeLimit(limit);

  return UserShowProgress.find({
    user: objectUserId,
  })
    .sort({
      totalWatchCount: -1,
      totalWatchMinutes: -1,
      lastWatchedAt: -1,
    })
    .limit(safeLimit)
    .select(
      [
        "show",
        "showTmdbId",
        "showName",
        "showNameAr",
        "posterPath",
        "backdropPath",
        "firstAirDate",
        "status",
        "progressPercentage",
        "watchedEpisodeCount",
        "airedEpisodeCount",
        "totalWatchCount",
        "rewatchCount",
        "totalWatchMinutes",
        "lastWatchedAt",
      ].join(" ")
    )
    .lean();
}

// ======================================================
// Most-rewatched episodes
// ======================================================

async function getMostRewatchedEpisodes(
  userId,
  {
    limit = 10,
  } = {}
) {
  const objectUserId =
    validateUserId(userId);

  const safeLimit =
    normalizeLimit(limit);

  return TVLog.aggregate([
    {
      $match: {
        user: objectUserId,
      },
    },

    {
      $sort: {
        watchedAt: -1,
        createdAt: -1,
      },
    },

    {
      $group: {
        _id: {
          showTmdbId:
            "$showTmdbId",

          seasonNumber:
            "$seasonNumber",

          episodeNumber:
            "$episodeNumber",
        },

        totalWatchCount: {
          $sum: 1,
        },

        latestLog: {
          $first: "$$ROOT",
        },
      },
    },

    {
      $addFields: {
        rewatchCount: {
          $max: [
            {
              $subtract: [
                "$totalWatchCount",
                1,
              ],
            },
            0,
          ],
        },
      },
    },

    {
      $match: {
        rewatchCount: {
          $gt: 0,
        },
      },
    },

    {
      $sort: {
        rewatchCount: -1,
        totalWatchCount: -1,
        "latestLog.watchedAt": -1,
      },
    },

    {
      $limit: safeLimit,
    },

    {
      $project: {
        _id: 0,

        showTmdbId:
          "$_id.showTmdbId",

        seasonNumber:
          "$_id.seasonNumber",

        episodeNumber:
          "$_id.episodeNumber",

        episodeTmdbId:
          "$latestLog.episodeTmdbId",

        showName:
          "$latestLog.showName",

        showPoster:
          "$latestLog.showPoster",

        showBackdrop:
          "$latestLog.showBackdrop",

        episodeName:
          "$latestLog.episodeName",

        episodeStillPath:
          "$latestLog.episodeStillPath",

        episodeRuntime:
          "$latestLog.episodeRuntime",

        totalWatchCount: 1,
        rewatchCount: 1,

        lastWatchedAt:
          "$latestLog.watchedAt",
      },
    },
  ]);
}

// ======================================================
// Rating distribution
// ======================================================

async function getTVRatingDistribution(
  userId
) {
  const objectUserId =
    validateUserId(userId);

  const results =
    await TVLog.aggregate([
      {
        $match: {
          user: objectUserId,

          rating: {
            $ne: null,
          },
        },
      },

      {
        $group: {
          _id: "$rating",
          count: {
            $sum: 1,
          },
        },
      },

      {
        $sort: {
          _id: 1,
        },
      },
    ]);

  const distribution = {};

  for (
    let rating = 0.5;
    rating <= 5;
    rating += 0.5
  ) {
    distribution[
      rating.toFixed(1)
    ] = 0;
  }

  for (const item of results) {
    const rating =
      Number(item._id);

    if (Number.isFinite(rating)) {
      distribution[
        rating.toFixed(1)
      ] = Number(item.count) || 0;
    }
  }

  return distribution;
}

// ======================================================
// Monthly TV activity
// ======================================================

async function getMonthlyTVActivity(
  userId,
  {
    months = 12,
  } = {}
) {
  const objectUserId =
    validateUserId(userId);

  const safeMonths = Math.min(
    60,
    Math.max(
      1,
      Number.isInteger(
        Number(months)
      )
        ? Number(months)
        : 12
    )
  );

  const startDate = new Date();

  startDate.setUTCDate(1);
  startDate.setUTCHours(
    0,
    0,
    0,
    0
  );

  startDate.setUTCMonth(
    startDate.getUTCMonth() -
      (safeMonths - 1)
  );

  const results =
    await TVLog.aggregate([
      {
        $match: {
          user: objectUserId,

          watchedAt: {
            $gte: startDate,
          },
        },
      },

      {
        $group: {
          _id: {
            year: {
              $year: "$watchedAt",
            },

            month: {
              $month: "$watchedAt",
            },
          },

          totalWatches: {
            $sum: 1,
          },

          rewatches: {
            $sum: {
              $cond: [
                "$rewatch",
                1,
                0,
              ],
            },
          },

          watchMinutes: {
            $sum: {
              $ifNull: [
                "$episodeRuntime",
                0,
              ],
            },
          },

          uniqueEpisodes: {
            $addToSet: {
              showTmdbId:
                "$showTmdbId",

              seasonNumber:
                "$seasonNumber",

              episodeNumber:
                "$episodeNumber",
            },
          },
        },
      },

      {
        $project: {
          _id: 0,

          year: "$_id.year",
          month: "$_id.month",

          totalWatches: 1,
          rewatches: 1,
          watchMinutes: 1,

          uniqueEpisodeCount: {
            $size:
              "$uniqueEpisodes",
          },
        },
      },

      {
        $sort: {
          year: 1,
          month: 1,
        },
      },
    ]);

  const resultMap = new Map(
    results.map((item) => [
      `${item.year}-${String(
        item.month
      ).padStart(2, "0")}`,
      item,
    ])
  );

  const timeline = [];

  for (
    let index = 0;
    index < safeMonths;
    index += 1
  ) {
    const date = new Date(
      Date.UTC(
        startDate.getUTCFullYear(),
        startDate.getUTCMonth() +
          index,
        1
      )
    );

    const year =
      date.getUTCFullYear();

    const month =
      date.getUTCMonth() + 1;

    const key =
      `${year}-${String(month).padStart(
        2,
        "0"
      )}`;

    const existing =
      resultMap.get(key);

    timeline.push({
      key,
      year,
      month,

      totalWatches:
        Number(
          existing?.totalWatches
        ) || 0,

      uniqueEpisodeCount:
        Number(
          existing
            ?.uniqueEpisodeCount
        ) || 0,

      rewatches:
        Number(
          existing?.rewatches
        ) || 0,

      watchMinutes:
        Number(
          existing?.watchMinutes
        ) || 0,
    });
  }

  return timeline;
}

// ======================================================
// Diary activity within a date range
// ======================================================

async function getTVActivityStats(
  userId,
  {
    startDate = null,
    endDate = null,
  } = {}
) {
  const objectUserId =
    validateUserId(userId);

  const match = {
    user: objectUserId,

    ...buildDateMatch({
      startDate,
      endDate,
      field: "watchedAt",
    }),
  };

  const logs = await TVLog.find(match)
    .select(
      [
        "showTmdbId",
        "seasonNumber",
        "episodeNumber",
        "episodeRuntime",
        "rating",
        "review",
        "gif",
        "image",
        "images",
        "rewatch",
        "watchedAt",
      ].join(" ")
    )
    .lean();

  const uniqueEpisodeKeys =
    new Set();

  let totalWatchMinutes = 0;
  let ratingCount = 0;
  let ratingTotal = 0;
  let reviewCount = 0;
  let rewatchCount = 0;

  for (const log of logs) {
    uniqueEpisodeKeys.add(
      [
        log.showTmdbId,
        log.seasonNumber,
        log.episodeNumber,
      ].join(":")
    );

    totalWatchMinutes += Math.max(
      0,
      Number(
        log.episodeRuntime
      ) || 0
    );

    if (log.rewatch) {
      rewatchCount += 1;
    }

    if (log.rating !== null) {
      ratingCount += 1;
      ratingTotal +=
        Number(log.rating) || 0;
    }

    if (hasReviewContent(log)) {
      reviewCount += 1;
    }
  }

  return {
    totalWatches:
      logs.length,

    uniqueEpisodes:
      uniqueEpisodeKeys.size,

    rewatches:
      rewatchCount,

    reviews:
      reviewCount,

    ratings: {
      count:
        ratingCount,

      average:
        ratingCount > 0
          ? Math.round(
              (
                ratingTotal /
                ratingCount
              ) * 100
            ) / 100
          : null,
    },

    watchTime:
      minutesToReadableTime(
        totalWatchMinutes
      ),
  };
}

// ======================================================
// Complete TV profile statistics package
// ======================================================

async function getCompleteTVStats(
  userId,
  {
    topLimit = 10,
    activityMonths = 12,
  } = {}
) {
  const [
    summary,
    mostWatchedShows,
    mostRewatchedEpisodes,
    ratingDistribution,
    monthlyActivity,
  ] = await Promise.all([
    getTVProfileStats(userId),

    getMostWatchedShows(
      userId,
      {
        limit: topLimit,
      }
    ),

    getMostRewatchedEpisodes(
      userId,
      {
        limit: topLimit,
      }
    ),

    getTVRatingDistribution(
      userId
    ),

    getMonthlyTVActivity(
      userId,
      {
        months:
          activityMonths,
      }
    ),
  ]);

  return {
    summary,
    mostWatchedShows,
    mostRewatchedEpisodes,
    ratingDistribution,
    monthlyActivity,
  };
}

// ======================================================
// Exports
// ======================================================

module.exports = {
  minutesToReadableTime,

  getTVProfileStats,
  getMostWatchedShows,
  getMostRewatchedEpisodes,
  getTVRatingDistribution,
  getMonthlyTVActivity,
  getTVActivityStats,
  getCompleteTVStats,
};