// src/services/tvProgressService.js

const mongoose = require("mongoose");

const TVLog = require("../models/tvLog");
const Show = require("../models/showModel");
const Episode = require("../models/episodeModel");
const UserShowProgress = require(
  "../models/userShowProgress"
);

// ======================================================
// Basic helpers
// ======================================================

function parsePositiveInteger(value) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function normalizeNonNegativeInteger(
  value,
  fallback = 0
) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function normalizeRuntime(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.round(parsed);
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

function episodeKey(
  seasonNumber,
  episodeNumber
) {
  return `${Number(seasonNumber)}:${Number(
    episodeNumber
  )}`;
}

function compareEpisodes(a, b) {
  const seasonDifference =
    Number(a.seasonNumber) -
    Number(b.seasonNumber);

  if (seasonDifference !== 0) {
    return seasonDifference;
  }

  return (
    Number(a.episodeNumber) -
    Number(b.episodeNumber)
  );
}

function isAiredEpisode(
  episode,
  now = new Date()
) {
  const airDate = normalizeDate(
    episode?.airDate
  );

  if (!airDate) {
    return false;
  }

  return airDate.getTime() <= now.getTime();
}

function isFutureEpisode(
  episode,
  now = new Date()
) {
  const airDate = normalizeDate(
    episode?.airDate
  );

  if (!airDate) {
    return false;
  }

  return airDate.getTime() > now.getTime();
}

function formatEpisodeSnapshot(episode) {
  if (!episode) {
    return null;
  }

  return {
    episodeTmdbId:
      Number(episode.tmdbId) || null,

    seasonNumber:
      Number(episode.seasonNumber),

    episodeNumber:
      Number(episode.episodeNumber),

    name:
      typeof episode.name === "string"
        ? episode.name.trim()
        : "",

    stillPath:
      typeof episode.stillPath === "string"
        ? episode.stillPath.trim()
        : "",

    airDate:
      normalizeDate(episode.airDate),

    runtime:
      Number.isFinite(
        Number(episode.runtime)
      )
        ? Number(episode.runtime)
        : null,
  };
}

function buildWatchedEpisodeKeySet(logs) {
  const keys = new Set();

  for (const log of logs) {
    keys.add(
      episodeKey(
        log.seasonNumber,
        log.episodeNumber
      )
    );
  }

  return keys;
}

function calculateProgressPercentage(
  watchedEpisodeCount,
  airedEpisodeCount
) {
  if (airedEpisodeCount <= 0) {
    return 0;
  }

  return Math.min(
    100,
    Math.round(
      (watchedEpisodeCount /
        airedEpisodeCount) *
        100
    )
  );
}

// ======================================================
// Resolve complete show metadata
// ======================================================

async function getShowMetadata(showTmdbId) {
  const parsedShowId =
    parsePositiveInteger(showTmdbId);

  if (!parsedShowId) {
    return null;
  }

  return Show.findOne({
    tmdbId: parsedShowId,
  }).lean();
}

// ======================================================
// Load all episode metadata for a show
// ======================================================

async function getShowEpisodes(
  showTmdbId,
  {
    includeSpecials = true,
  } = {}
) {
  const parsedShowId =
    parsePositiveInteger(showTmdbId);

  if (!parsedShowId) {
    return [];
  }

  const query = {
    showTmdbId: parsedShowId,
  };

  if (!includeSpecials) {
    query.seasonNumber = {
      $gt: 0,
    };
  }

  return Episode.find(query)
    .sort({
      seasonNumber: 1,
      episodeNumber: 1,
    })
    .lean();
}

// ======================================================
// Load all logs for one user/show
// ======================================================

async function getUserShowLogs(
  userId,
  showTmdbId
) {
  const parsedShowId =
    parsePositiveInteger(showTmdbId);

  if (
    !mongoose.isValidObjectId(userId) ||
    !parsedShowId
  ) {
    return [];
  }

  return TVLog.find({
    user: userId,
    showTmdbId: parsedShowId,
  })
    .sort({
      watchedAt: 1,
      createdAt: 1,
    })
    .lean();
}

// ======================================================
// Runtime calculation
// ======================================================

function calculateTotalWatchMinutes({
  logs,
  episodeMap,
}) {
  let totalMinutes = 0;

  for (const log of logs) {
    let runtime = normalizeRuntime(
      log.episodeRuntime
    );

    if (runtime <= 0) {
      const key = episodeKey(
        log.seasonNumber,
        log.episodeNumber
      );

      runtime = normalizeRuntime(
        episodeMap.get(key)?.runtime
      );
    }

    totalMinutes += runtime;
  }

  return totalMinutes;
}

// ======================================================
// Season progress calculation
// ======================================================

function calculateSeasonProgress({
  episodes,
  watchedEpisodeKeys,
  includeSpecials = false,
  now = new Date(),
}) {
  const seasonMap = new Map();

  for (const episode of episodes) {
    const seasonNumber = Number(
      episode.seasonNumber
    );

    if (
      !Number.isInteger(seasonNumber) ||
      seasonNumber < 0
    ) {
      continue;
    }

    if (
      seasonNumber === 0 &&
      !includeSpecials
    ) {
      continue;
    }

    if (!seasonMap.has(seasonNumber)) {
      seasonMap.set(seasonNumber, {
        seasonNumber,
        airedEpisodeCount: 0,
        watchedEpisodeCount: 0,
        totalEpisodeCount: 0,
        progressPercentage: 0,
        completed: false,
      });
    }

    const summary =
      seasonMap.get(seasonNumber);

    summary.totalEpisodeCount += 1;

    if (!isAiredEpisode(episode, now)) {
      continue;
    }

    summary.airedEpisodeCount += 1;

    const key = episodeKey(
      episode.seasonNumber,
      episode.episodeNumber
    );

    if (watchedEpisodeKeys.has(key)) {
      summary.watchedEpisodeCount += 1;
    }
  }

  const summaries = Array.from(
    seasonMap.values()
  )
    .map((summary) => {
      summary.progressPercentage =
        calculateProgressPercentage(
          summary.watchedEpisodeCount,
          summary.airedEpisodeCount
        );

      summary.completed =
        summary.airedEpisodeCount > 0 &&
        summary.watchedEpisodeCount >=
          summary.airedEpisodeCount;

      return summary;
    })
    .sort(
      (a, b) =>
        a.seasonNumber -
        b.seasonNumber
    );

  return summaries;
}

// ======================================================
// Next episode calculation
// ======================================================

function findNextUnwatchedEpisode({
  episodes,
  watchedEpisodeKeys,
  now = new Date(),
}) {
  const regularAiredEpisodes =
    episodes
      .filter(
        (episode) =>
          Number(episode.seasonNumber) >
            0 &&
          isAiredEpisode(episode, now)
      )
      .sort(compareEpisodes);

  const nextEpisode =
    regularAiredEpisodes.find(
      (episode) =>
        !watchedEpisodeKeys.has(
          episodeKey(
            episode.seasonNumber,
            episode.episodeNumber
          )
        )
    );

  return formatEpisodeSnapshot(
    nextEpisode || null
  );
}

function findNextScheduledEpisode({
  episodes,
  now = new Date(),
}) {
  const futureEpisodes = episodes
    .filter(
      (episode) =>
        Number(episode.seasonNumber) >
          0 &&
        isFutureEpisode(episode, now)
    )
    .sort((a, b) => {
      const dateA =
        normalizeDate(a.airDate)?.getTime() ||
        Number.MAX_SAFE_INTEGER;

      const dateB =
        normalizeDate(b.airDate)?.getTime() ||
        Number.MAX_SAFE_INTEGER;

      if (dateA !== dateB) {
        return dateA - dateB;
      }

      return compareEpisodes(a, b);
    });

  return formatEpisodeSnapshot(
    futureEpisodes[0] || null
  );
}

// ======================================================
// Build one progress payload
// ======================================================

async function calculateUserShowProgress(
  userId,
  showTmdbId,
  {
    now = new Date(),
  } = {}
) {
  const parsedShowId =
    parsePositiveInteger(showTmdbId);

  if (!mongoose.isValidObjectId(userId)) {
    throw new Error("Invalid user ID");
  }

  if (!parsedShowId) {
    throw new Error("Invalid TMDB show ID");
  }

  const [
    show,
    episodes,
    logs,
  ] = await Promise.all([
    getShowMetadata(parsedShowId),

    getShowEpisodes(parsedShowId, {
      includeSpecials: true,
    }),

    getUserShowLogs(
      userId,
      parsedShowId
    ),
  ]);

  if (logs.length === 0) {
    return {
      hasStarted: false,
      show,
      episodes,
      logs,
      progress: null,
    };
  }

  const watchedEpisodeKeys =
    buildWatchedEpisodeKeySet(logs);

  const regularEpisodes =
    episodes.filter(
      (episode) =>
        Number(episode.seasonNumber) >
        0
    );

  const specials =
    episodes.filter(
      (episode) =>
        Number(episode.seasonNumber) ===
        0
    );

  const airedRegularEpisodes =
    regularEpisodes.filter(
      (episode) =>
        isAiredEpisode(episode, now)
    );

  const watchedRegularKeys =
    new Set(
      logs
        .filter(
          (log) =>
            Number(log.seasonNumber) >
            0
        )
        .map((log) =>
          episodeKey(
            log.seasonNumber,
            log.episodeNumber
          )
        )
    );

  const watchedSpecialKeys =
    new Set(
      logs
        .filter(
          (log) =>
            Number(log.seasonNumber) ===
            0
        )
        .map((log) =>
          episodeKey(
            log.seasonNumber,
            log.episodeNumber
          )
        )
    );

  const watchedAiredRegularKeys =
    new Set();

  for (
    const episode of airedRegularEpisodes
  ) {
    const key = episodeKey(
      episode.seasonNumber,
      episode.episodeNumber
    );

    if (watchedRegularKeys.has(key)) {
      watchedAiredRegularKeys.add(key);
    }
  }

  const seasonProgress =
    calculateSeasonProgress({
      episodes: regularEpisodes,
      watchedEpisodeKeys,
      now,
    });

  const completedSeasonCount =
    seasonProgress.filter(
      (season) => season.completed
    ).length;

  const airedSeasonCount =
    seasonProgress.filter(
      (season) =>
        season.airedEpisodeCount > 0
    ).length;

  const latestLog = [...logs].sort(
    (a, b) => {
      const watchedDifference =
        new Date(
          b.watchedAt ||
            b.createdAt
        ).getTime() -
        new Date(
          a.watchedAt ||
            a.createdAt
        ).getTime();

      if (watchedDifference !== 0) {
        return watchedDifference;
      }

      return (
        new Date(b.createdAt).getTime() -
        new Date(a.createdAt).getTime()
      );
    }
  )[0];

  const firstLog = [...logs].sort(
    (a, b) =>
      new Date(
        a.watchedAt ||
          a.createdAt
      ).getTime() -
      new Date(
        b.watchedAt ||
          b.createdAt
      ).getTime()
  )[0];

  const episodeMap = new Map(
    episodes.map((episode) => [
      episodeKey(
        episode.seasonNumber,
        episode.episodeNumber
      ),
      episode,
    ])
  );

  const totalWatchCount =
    logs.length;

  const uniqueWatchedEpisodeCount =
    watchedEpisodeKeys.size;

  const rewatchCount = Math.max(
    0,
    totalWatchCount -
      uniqueWatchedEpisodeCount
  );

  const watchedEpisodeCount =
    watchedAiredRegularKeys.size;

  const watchedSpecialCount =
    watchedSpecialKeys.size;

  const airedEpisodeCount =
    airedRegularEpisodes.length;

  const totalEpisodeCount =
    regularEpisodes.length;

  const progressPercentage =
    calculateProgressPercentage(
      watchedEpisodeCount,
      airedEpisodeCount
    );

  const isCaughtUp =
    airedEpisodeCount > 0 &&
    watchedEpisodeCount >=
      airedEpisodeCount;

  const nextUnwatchedEpisode =
    findNextUnwatchedEpisode({
      episodes,
      watchedEpisodeKeys,
      now,
    });

  const nextScheduledEpisode =
    findNextScheduledEpisode({
      episodes,
      now,
    });

  const totalWatchMinutes =
    calculateTotalWatchMinutes({
      logs,
      episodeMap,
    });

  return {
    hasStarted: true,

    show,
    episodes,
    logs,

    seasonProgress,

    progress: {
      user: userId,

      show:
        show?._id || null,

      showTmdbId:
        parsedShowId,

      showName:
        show?.name ||
        latestLog.showName ||
        "Untitled Show",

      showNameAr:
        show?.nameAr || "",

      posterPath:
        show?.posterPath ||
        latestLog.showPoster ||
        "",

      backdropPath:
        show?.backdropPath ||
        latestLog.showBackdrop ||
        "",

      firstAirDate:
        normalizeDate(
          show?.firstAirDate ||
            latestLog.firstAirDate
        ),

      status:
        isCaughtUp
          ? "completed"
          : "watching",

      watchedEpisodeCount,

      watchedSpecialCount,

      airedEpisodeCount,

      totalEpisodeCount,

      progressPercentage,

      completedSeasonCount,

      airedSeasonCount,

      totalWatchCount,

      rewatchCount,

      totalWatchMinutes,

      lastWatchedAt:
        normalizeDate(
          latestLog.watchedAt ||
            latestLog.createdAt
        ),

      lastLog:
        latestLog._id,

      lastSeasonNumber:
        latestLog.seasonNumber,

      lastEpisodeNumber:
        latestLog.episodeNumber,

      lastEpisodeTmdbId:
        latestLog.episodeTmdbId ||
        null,

      lastEpisodeName:
        latestLog.episodeName || "",

      lastEpisodeStillPath:
        latestLog.episodeStillPath ||
        "",

      lastWatchNumber:
        latestLog.watchNumber || 1,

      lastWasRewatch:
        Number(
          latestLog.watchNumber
        ) > 1,

      nextUnwatchedEpisode,

      isCaughtUp,

      nextScheduledEpisode,

      startedAt:
        normalizeDate(
          firstLog.watchedAt ||
            firstLog.createdAt
        ),

      metadataLastSyncedAt:
        show?.progressMetadataSyncedAt ||
        show?.lastSyncedAt ||
        null,

      lastCalculatedAt:
        new Date(),
    },
  };
}

// ======================================================
// Rebuild one user/show progress document
// ======================================================

async function rebuildUserShowProgress(
  userId,
  showTmdbId,
  {
    deleteIfNoLogs = true,
  } = {}
) {
  const result =
    await calculateUserShowProgress(
      userId,
      showTmdbId
    );

  if (!result.hasStarted) {
    if (deleteIfNoLogs) {
      await UserShowProgress.deleteOne({
        user: userId,
        showTmdbId:
          Number(showTmdbId),
      });
    }

    return null;
  }

  const existing =
    await UserShowProgress.findOne({
      user: userId,
      showTmdbId:
        Number(showTmdbId),
    }).select(
      "firstCompletedAt startedAt"
    );

  const update = {
    ...result.progress,
  };

  if (existing?.firstCompletedAt) {
    update.firstCompletedAt =
      existing.firstCompletedAt;
  }

  if (existing?.startedAt) {
    update.startedAt =
      existing.startedAt;
  }

  const progress =
    await UserShowProgress.findOneAndUpdate(
      {
        user: userId,
        showTmdbId:
          Number(showTmdbId),
      },
      {
        $set: update,
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      }
    );

  return progress;
}

// ======================================================
// Rebuild all shows belonging to one user
// ======================================================

async function rebuildAllUserShowProgress(
  userId
) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error("Invalid user ID");
  }

  const showIds =
    await TVLog.distinct(
      "showTmdbId",
      {
        user: userId,
      }
    );

  const validShowIds = showIds
    .map(Number)
    .filter(
      (showTmdbId) =>
        Number.isInteger(showTmdbId) &&
        showTmdbId > 0
    );

  const rebuilt = [];
  const failed = [];

  for (const showTmdbId of validShowIds) {
    try {
      const progress =
        await rebuildUserShowProgress(
          userId,
          showTmdbId
        );

      if (progress) {
        rebuilt.push(progress);
      }
    } catch (error) {
      console.error(
        `❌ Failed to rebuild TV progress for user ${userId}, show ${showTmdbId}:`,
        error.message
      );

      failed.push({
        showTmdbId,
        error: error.message,
      });
    }
  }

  await UserShowProgress.deleteMany({
    user: userId,

    showTmdbId: {
      $nin: validShowIds,
    },
  });

  return {
    totalShows:
      validShowIds.length,

    rebuiltCount:
      rebuilt.length,

    failedCount:
      failed.length,

    rebuilt,
    failed,
  };
}

// ======================================================
// Read one cached progress document
// ======================================================

async function getUserShowProgress(
  userId,
  showTmdbId,
  {
    rebuildIfMissing = false,
  } = {}
) {
  const parsedShowId =
    parsePositiveInteger(showTmdbId);

  if (
    !mongoose.isValidObjectId(userId) ||
    !parsedShowId
  ) {
    return null;
  }

  let progress =
    await UserShowProgress.findOne({
      user: userId,
      showTmdbId: parsedShowId,
    });

  if (
    !progress &&
    rebuildIfMissing
  ) {
    progress =
      await rebuildUserShowProgress(
        userId,
        parsedShowId
      );
  }

  return progress;
}

// ======================================================
// Detailed season progress
// ======================================================

async function getUserSeasonProgress(
  userId,
  showTmdbId,
  seasonNumber
) {
  const parsedShowId =
    parsePositiveInteger(showTmdbId);

  const parsedSeasonNumber =
    Number(seasonNumber);

  if (
    !mongoose.isValidObjectId(userId) ||
    !parsedShowId ||
    !Number.isInteger(
      parsedSeasonNumber
    ) ||
    parsedSeasonNumber < 0
  ) {
    return null;
  }

  const [episodes, logs] =
    await Promise.all([
      Episode.find({
        showTmdbId: parsedShowId,
        seasonNumber:
          parsedSeasonNumber,
      })
        .sort({
          episodeNumber: 1,
        })
        .lean(),

      TVLog.find({
        user: userId,
        showTmdbId:
          parsedShowId,
        seasonNumber:
          parsedSeasonNumber,
      })
        .sort({
          watchedAt: -1,
          createdAt: -1,
        })
        .lean(),
    ]);

  const watchedKeys =
    buildWatchedEpisodeKeySet(logs);

  const summaries =
    calculateSeasonProgress({
      episodes,
      watchedEpisodeKeys:
        watchedKeys,
      includeSpecials: true,
    });

  const summary =
    summaries.find(
      (item) =>
        item.seasonNumber ===
        parsedSeasonNumber
    ) || {
      seasonNumber:
        parsedSeasonNumber,

      airedEpisodeCount: 0,
      watchedEpisodeCount: 0,
      totalEpisodeCount:
        episodes.length,
      progressPercentage: 0,
      completed: false,
    };

  const watchCountByEpisode =
    new Map();

  for (const log of logs) {
    const key = episodeKey(
      log.seasonNumber,
      log.episodeNumber
    );

    const existing =
      watchCountByEpisode.get(key) || {
        count: 0,
        latestLog: null,
      };

    existing.count += 1;

    if (!existing.latestLog) {
      existing.latestLog = log;
    }

    watchCountByEpisode.set(
      key,
      existing
    );
  }

  const formattedEpisodes =
    episodes.map((episode) => {
      const key = episodeKey(
        episode.seasonNumber,
        episode.episodeNumber
      );

      const history =
        watchCountByEpisode.get(key);

      return {
        episodeTmdbId:
          episode.tmdbId ||
          null,

        seasonNumber:
          episode.seasonNumber,

        episodeNumber:
          episode.episodeNumber,

        name:
          episode.name || "",

        stillPath:
          episode.stillPath || "",

        airDate:
          episode.airDate || null,

        runtime:
          episode.runtime ?? null,

        aired:
          isAiredEpisode(episode),

        watched:
          Boolean(history),

        watchCount:
          history?.count || 0,

        latestLogId:
          history?.latestLog?._id ||
          null,

        latestRating:
          history?.latestLog?.rating ??
          null,

        latestWatchNumber:
          history?.latestLog
            ?.watchNumber || 0,

        hasReview:
          Boolean(
            history?.latestLog?.review ||
              history?.latestLog?.gif ||
              history?.latestLog?.image ||
              (
                Array.isArray(
                  history?.latestLog
                    ?.images
                ) &&
                history.latestLog
                  .images.length > 0
              )
          ),
      };
    });

  return {
    ...summary,

    totalWatchCount:
      logs.length,

    rewatchCount:
      Math.max(
        0,
        logs.length -
          watchedKeys.size
      ),

    episodes:
      formattedEpisodes,
  };
}

// ======================================================
// Upcoming Episodes / Continue Watching
// ======================================================

async function getContinueWatching(
  userId,
  {
    limit = 30,
    includeCaughtUp = false,
  } = {}
) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error("Invalid user ID");
  }

  const safeLimit = Math.min(
    100,
    Math.max(
      1,
      normalizeNonNegativeInteger(
        limit,
        30
      )
    )
  );

  const query = {
    user: userId,
    watchedEpisodeCount: {
      $gt: 0,
    },
  };

  if (!includeCaughtUp) {
    query.isCaughtUp = false;
    query.nextUnwatchedEpisode = {
      $ne: null,
    };
  }

  return UserShowProgress.find(query)
    .sort({
      lastWatchedAt: -1,
    })
    .limit(safeLimit)
    .lean();
}

// ======================================================
// Progress for multiple users on one show
// ======================================================

async function getUsersShowProgress(
  userIds,
  showTmdbId
) {
  const parsedShowId =
    parsePositiveInteger(showTmdbId);

  if (
    !Array.isArray(userIds) ||
    !parsedShowId
  ) {
    return [];
  }

  const validUserIds = [
    ...new Set(
      userIds
        .filter((userId) =>
          mongoose.isValidObjectId(
            userId
          )
        )
        .map(String)
    ),
  ];

  if (validUserIds.length === 0) {
    return [];
  }

  return UserShowProgress.find({
    user: {
      $in: validUserIds,
    },

    showTmdbId:
      parsedShowId,

    watchedEpisodeCount: {
      $gt: 0,
    },
  })
    .populate(
      "user",
      "username profilePicture name"
    )
    .sort({
      progressPercentage: -1,
      lastWatchedAt: -1,
    })
    .lean();
}

// ======================================================
// Average following progress
// ======================================================

async function getAverageUsersProgress(
  userIds,
  showTmdbId
) {
  const progressDocuments =
    await getUsersShowProgress(
      userIds,
      showTmdbId
    );

  if (
    progressDocuments.length === 0
  ) {
    return {
      averageProgressPercentage: 0,
      userCount: 0,
      users: [],
    };
  }

  const total =
    progressDocuments.reduce(
      (sum, progress) =>
        sum +
        Number(
          progress.progressPercentage ||
            0
        ),
      0
    );

  return {
    averageProgressPercentage:
      Math.round(
        total /
          progressDocuments.length
      ),

    userCount:
      progressDocuments.length,

    users:
      progressDocuments,
  };
}

// ======================================================
// TV profile summary
// ======================================================

async function getUserTVProgressSummary(
  userId
) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error("Invalid user ID");
  }

  const summary =
    await UserShowProgress.aggregate([
      {
        $match: {
          user:
            new mongoose.Types.ObjectId(
              userId
            ),
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

          watchedEpisodeCount: {
            $sum:
              "$watchedEpisodeCount",
          },

          watchedSpecialCount: {
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
    ]);

  const result = summary[0] || {};

  return {
    startedShowCount:
      result.startedShowCount || 0,

    completedShowCount:
      result.completedShowCount || 0,

    watchedEpisodeCount:
      result.watchedEpisodeCount || 0,

    watchedSpecialCount:
      result.watchedSpecialCount || 0,

    completedSeasonCount:
      result.completedSeasonCount || 0,

    totalWatchCount:
      result.totalWatchCount || 0,

    rewatchCount:
      result.rewatchCount || 0,

    totalWatchMinutes:
      result.totalWatchMinutes || 0,
  };
}

// ======================================================
// Rebuild everyone who started one show
// ======================================================

async function rebuildShowProgressForAllUsers(
  showTmdbId
) {
  const parsedShowId =
    parsePositiveInteger(showTmdbId);

  if (!parsedShowId) {
    throw new Error("Invalid TMDB show ID");
  }

  const userIds =
    await TVLog.distinct("user", {
      showTmdbId:
        parsedShowId,
    });

  const rebuilt = [];
  const failed = [];

  for (const userId of userIds) {
    try {
      const progress =
        await rebuildUserShowProgress(
          userId,
          parsedShowId
        );

      if (progress) {
        rebuilt.push(progress);
      }
    } catch (error) {
      failed.push({
        userId,
        error: error.message,
      });
    }
  }

  return {
    showTmdbId:
      parsedShowId,

    userCount:
      userIds.length,

    rebuiltCount:
      rebuilt.length,

    failedCount:
      failed.length,

    failed,
  };
}

// ======================================================
// Exports
// ======================================================

module.exports = {
  episodeKey,
  isAiredEpisode,
  formatEpisodeSnapshot,

  getShowEpisodes,
  getUserShowLogs,

  calculateSeasonProgress,
  findNextUnwatchedEpisode,
  findNextScheduledEpisode,

  calculateUserShowProgress,
  rebuildUserShowProgress,
  rebuildAllUserShowProgress,
  rebuildShowProgressForAllUsers,

  getUserShowProgress,
  getUserSeasonProgress,

  getContinueWatching,

  getUsersShowProgress,
  getAverageUsersProgress,

  getUserTVProgressSummary,
};

