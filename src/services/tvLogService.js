// src/services/tvLogService.js

const mongoose = require("mongoose");

const TVLog = require("../models/tvLog");
const Show = require("../models/showModel");
const Season = require("../models/seasonModel");
const Episode = require("../models/episodeModel");

const CustomShowPoster = require(
  "../models/customShowPoster"
);



const CustomEpisodeBackdrop = require(
  "../models/customEpisodeBackdrop"
);

const {
  syncEpisodeFromTMDB,
  syncSeasonFromTMDB,
} = require("./tvMetadataService");

const {
  rebuildUserShowProgress,
} = require("./tvProgressService");

// ======================================================
// Constants
// ======================================================

const VALID_LOG_METHODS = new Set([
  "full",
  "quick",
  "bulk_season",
  "import",
]);

const VALID_SOURCES = new Set([
  "manual",
  "tv_time_import",
  "scene_import",
  "system",
]);

// ======================================================
// Errors
// ======================================================

class TVLogServiceError extends Error {
  constructor(
    message,
    {
      statusCode = 400,
      code = "TV_LOG_ERROR",
      details = null,
    } = {}
  ) {
    super(message);

    this.name = "TVLogServiceError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

// ======================================================
// Basic helpers
// ======================================================

function requireValidUserId(userId) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new TVLogServiceError(
      "Invalid user ID",
      {
        statusCode: 400,
        code: "INVALID_USER_ID",
      }
    );
  }

  return userId;
}

function parsePositiveInteger(
  value,
  fieldName
) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 1
  ) {
    throw new TVLogServiceError(
      `Invalid ${fieldName}`,
      {
        statusCode: 400,

        code: `INVALID_${fieldName
          .toUpperCase()
          .replace(/\s+/g, "_")}`,
      }
    );
  }

  return parsed;
}

function parseSeasonNumber(value) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 0
  ) {
    throw new TVLogServiceError(
      "Invalid season number",
      {
        statusCode: 400,
        code: "INVALID_SEASON_NUMBER",
      }
    );
  }

  return parsed;
}

function normalizeString(
  value,
  maximumLength = null
) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized =
    value.trim();

  if (
    maximumLength &&
    normalized.length >
      maximumLength
  ) {
    return normalized.slice(
      0,
      maximumLength
    );
  }

  return normalized;
}

function hasOwn(
  object,
  field
) {
  return Object.prototype
    .hasOwnProperty
    .call(
      object || {},
      field
    );
}

function normalizeOptionalDate(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    throw new TVLogServiceError(
      "Invalid watch date",
      {
        statusCode: 400,
        code: "INVALID_WATCH_DATE",
      }
    );
  }

  return date;
}

function normalizeRating(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const rating =
    Number(value);

  if (
    !Number.isFinite(rating) ||
    rating < 0.5 ||
    rating > 5 ||
    !Number.isInteger(
      rating * 2
    )
  ) {
    throw new TVLogServiceError(
      "Rating must use half-star increments between 0.5 and 5",
      {
        statusCode: 400,
        code: "INVALID_RATING",
      }
    );
  }

  return rating;
}

function normalizeImages(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .filter(
          (item) =>
            typeof item ===
            "string"
        )
        .map(
          (item) =>
            item.trim()
        )
        .filter(Boolean)
    ),
  ].slice(0, 10);
}

function normalizeFavoriteCharacter(
  value
) {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return null;
  }

  const character = {
    characterId:
      Number.isFinite(
        Number(
          value.characterId
        )
      )
        ? Number(
            value.characterId
          )
        : null,

    actorId:
      Number.isFinite(
        Number(
          value.actorId
        )
      )
        ? Number(
            value.actorId
          )
        : null,

    characterName:
      normalizeString(
        value.characterName,
        300
      ),

    actorName:
      normalizeString(
        value.actorName,
        300
      ),

    profilePath:
      normalizeString(
        value.profilePath,
        1000
      ),
  };

  const hasData = Boolean(
    character.characterId !==
      null ||
      character.actorId !==
        null ||
      character.characterName ||
      character.actorName ||
      character.profilePath
  );

  return hasData
    ? character
    : null;
}

function hasReviewContent(payload) {
  return Boolean(
    normalizeString(
      payload.review
    ) ||
      normalizeString(
        payload.gif
      ) ||
      normalizeString(
        payload.image
      ) ||
      normalizeImages(
        payload.images
      ).length > 0
  );
}

function isEpisodeAired(episode) {
  if (!episode?.airDate) {
    return false;
  }

  const airDate =
    new Date(
      episode.airDate
    );

  if (
    Number.isNaN(
      airDate.getTime()
    )
  ) {
    return false;
  }

  return (
    airDate.getTime() <=
    Date.now()
  );
}

function getEpisodeIdentityFilter({
  userId,
  showTmdbId,
  seasonNumber,
  episodeNumber,
}) {
  return {
    user:
      userId,

    showTmdbId,

    seasonNumber,

    episodeNumber,
  };
}

// ======================================================
// Saved artwork resolution
// ======================================================

/**
 * Priority:
 *
 * 1. Explicit value sent for this exact log.
 * 2. User's saved default artwork.
 * 3. Empty custom-artwork snapshot, allowing normal TMDB
 *    poster/backdrop fields to display naturally.
 *
 * Explicit empty strings are respected. This allows a client to
 * intentionally create a log without applying the saved default.
 */
async function resolveSavedArtwork({
  userId,
  showTmdbId,
  seasonNumber,
  episodeNumber,
  input = {},
}) {
  const explicitlySetShowPoster =
    hasOwn(
      input,
      "customShowPoster"
    );

  const explicitlySetEpisodeBackdrop =
    hasOwn(
      input,
      "customEpisodeBackdrop"
    );

  const [
    savedShowPoster,
    savedEpisodeBackdrop,
  ] = await Promise.all([
    explicitlySetShowPoster
      ? Promise.resolve(null)
      : CustomShowPoster.findOne({
          userId,

          showId:
            showTmdbId,
        })
          .select(
            "posterUrl"
          )
          .lean(),

    explicitlySetEpisodeBackdrop
      ? Promise.resolve(null)
      : CustomEpisodeBackdrop.findOne({
          userId,

          showId:
            showTmdbId,

          seasonNumber,

          episodeNumber,
        })
          .select(
            "backdropUrl"
          )
          .lean(),
  ]);

  return {
    customShowPoster:
      explicitlySetShowPoster
        ? normalizeString(
            input.customShowPoster,
            2000
          )
        : normalizeString(
            savedShowPoster
              ?.posterUrl,
            2000
          ),

    customEpisodeBackdrop:
      explicitlySetEpisodeBackdrop
        ? normalizeString(
            input.customEpisodeBackdrop,
            2000
          )
        : normalizeString(
            savedEpisodeBackdrop
              ?.backdropUrl,
            2000
          ),
  };
}

/**
 * Resolves one show poster and every saved episode backdrop
 * for a season in two database queries.
 *
 * This prevents one artwork query per episode during bulk logging.
 */
async function resolveBulkSeasonArtwork({
  userId,
  showTmdbId,
  seasonNumber,
}) {
  const [
    savedShowPoster,
    savedEpisodeBackdrops,
  ] = await Promise.all([
    CustomShowPoster.findOne({
      userId,

      showId:
        showTmdbId,
    })
      .select(
        "posterUrl"
      )
      .lean(),

    CustomEpisodeBackdrop.find({
      userId,

      showId:
        showTmdbId,

      seasonNumber,
    })
      .select(
        "episodeNumber backdropUrl"
      )
      .lean(),
  ]);

  const backdropByEpisodeNumber =
    new Map();

  for (
    const artwork of
      savedEpisodeBackdrops
  ) {
    backdropByEpisodeNumber.set(
      Number(
        artwork.episodeNumber
      ),

      normalizeString(
        artwork.backdropUrl,
        2000
      )
    );
  }

  return {
    customShowPoster:
      normalizeString(
        savedShowPoster
          ?.posterUrl,
        2000
      ),

    backdropByEpisodeNumber,
  };
}

// ======================================================
// Metadata resolution
// ======================================================

async function resolveEpisodeMetadata({
  showTmdbId,
  seasonNumber,
  episodeNumber,
  syncIfMissing = true,
}) {
  let episode =
    await Episode.findOne({
      showTmdbId,
      seasonNumber,
      episodeNumber,
    });

  if (
    !episode &&
    syncIfMissing
  ) {
    episode =
      await syncEpisodeFromTMDB(
        showTmdbId,
        seasonNumber,
        episodeNumber
      );
  }

  if (!episode) {
    throw new TVLogServiceError(
      "Episode not found",
      {
        statusCode: 404,
        code: "EPISODE_NOT_FOUND",
      }
    );
  }

  const [
    show,
    season,
  ] = await Promise.all([
    Show.findOne({
      tmdbId:
        showTmdbId,
    }),

    Season.findOne({
      showTmdbId,
      seasonNumber,
    }),
  ]);

  if (!show) {
    throw new TVLogServiceError(
      "Show metadata not found",
      {
        statusCode: 404,
        code: "SHOW_NOT_FOUND",
      }
    );
  }

  return {
    show,
    season,
    episode,
  };
}

// ======================================================
// Watch-number helpers
// ======================================================

async function getNextWatchNumber({
  userId,
  showTmdbId,
  seasonNumber,
  episodeNumber,
}) {
  const latestLog =
    await TVLog.findOne(
      getEpisodeIdentityFilter({
        userId,
        showTmdbId,
        seasonNumber,
        episodeNumber,
      })
    )
      .sort({
        watchNumber: -1,
        watchedAt: -1,
        createdAt: -1,
      })
      .select(
        "watchNumber"
      )
      .lean();

  return latestLog
    ? Math.max(
        1,
        Number(
          latestLog.watchNumber
        ) || 1
      ) + 1
    : 1;
}

async function renumberEpisodeWatchHistory({
  userId,
  showTmdbId,
  seasonNumber,
  episodeNumber,
}) {
  const logs =
    await TVLog.find(
      getEpisodeIdentityFilter({
        userId,
        showTmdbId,
        seasonNumber,
        episodeNumber,
      })
    ).sort({
      watchedAt: 1,
      createdAt: 1,
      _id: 1,
    });

  if (
    logs.length === 0
  ) {
    return [];
  }

  const operations = [];

  for (
    let index = 0;
    index < logs.length;
    index += 1
  ) {
    const watchNumber =
      index + 1;

    const rewatch =
      watchNumber > 1;

    if (
      logs[index]
        .watchNumber !==
        watchNumber ||
      logs[index].rewatch !==
        rewatch
    ) {
      operations.push({
        updateOne: {
          filter: {
            _id:
              logs[index]._id,
          },

          update: {
            $set: {
              watchNumber,
              rewatch,
            },
          },
        },
      });
    }
  }

  if (
    operations.length > 0
  ) {
    await TVLog.bulkWrite(
      operations,
      {
        ordered: true,
      }
    );
  }

  return TVLog.find(
    getEpisodeIdentityFilter({
      userId,
      showTmdbId,
      seasonNumber,
      episodeNumber,
    })
  ).sort({
    watchNumber: 1,
  });
}

// ======================================================
// Build log document payload
// ======================================================

function buildTVLogPayload({
  userId,
  show,
  episode,
  input,
  watchNumber,
  logMethod,
  source,
}) {
  const images =
    normalizeImages(
      input.images
    );

  const image =
    normalizeString(
      input.image,
      2000
    ) ||
    images[0] ||
    "";

  if (
    image &&
    !images.includes(image)
  ) {
    images.unshift(image);
  }

  const watchedAt =
    normalizeOptionalDate(
      input.watchedAt
    ) ||
    new Date();

  return {
    user:
      userId,

    show:
      show?._id ||
      null,

    showTmdbId:
      Number(
        show.tmdbId
      ),

    showName:
      show.name ||
      "Untitled Show",

    showPoster:
      input.showPoster !==
      undefined
        ? normalizeString(
            input.showPoster,
            2000
          )
        : normalizeString(
            show.posterPath,
            2000
          ),

    showBackdrop:
      input.showBackdrop !==
      undefined
        ? normalizeString(
            input.showBackdrop,
            2000
          )
        : normalizeString(
            show.backdropPath,
            2000
          ),

    firstAirDate:
      show.firstAirDate
        ? new Date(
            show.firstAirDate
          )
            .toISOString()
            .slice(0, 10)
        : "",

    seasonNumber:
      Number(
        episode.seasonNumber
      ),

    episodeNumber:
      Number(
        episode.episodeNumber
      ),

    episodeTmdbId:
      Number(
        episode.tmdbId
      ) || null,

    episodeName:
      episode.name ||
      "",

    episodeOverview:
      episode.overview ||
      "",

    episodeAirDate:
      episode.airDate
        ? new Date(
            episode.airDate
          )
            .toISOString()
            .slice(0, 10)
        : "",

    episodeRuntime:
      Number.isFinite(
        Number(
          episode.runtime
        )
      )
        ? Number(
            episode.runtime
          )
        : null,

    episodeStillPath:
      normalizeString(
        episode.stillPath,
        2000
      ),

    customEpisodeBackdrop:
      normalizeString(
        input.customEpisodeBackdrop,
        2000
      ),

    customShowPoster:
      normalizeString(
        input.customShowPoster,
        2000
      ),

    review:
      normalizeString(
        input.review,
        20000
      ),

    rating:
      normalizeRating(
        input.rating
      ),

    containsSpoilers:
      input.containsSpoilers ===
      true,

    watchedAt,

    watchNumber,

    rewatch:
      watchNumber > 1,

    logMethod,

    source,

    importJob:
      mongoose.isValidObjectId(
        input.importJob
      )
        ? input.importJob
        : null,

    externalImportId:
      normalizeString(
        input.externalImportId,
        1000
      ) || null,

    gif:
      normalizeString(
        input.gif,
        2000
      ),

    image,

    images,

    favoriteCharacter:
      normalizeFavoriteCharacter(
        input.favoriteCharacter
      ),

    likes: [],

    replies: [],
  };
}

// ======================================================
// Create full or quick episode log
// ======================================================

async function createEpisodeLog({
  userId,
  showTmdbId,
  seasonNumber,
  episodeNumber,
  input = {},
  logMethod = "full",
  source = "manual",
  allowUnaired = false,
}) {
  requireValidUserId(
    userId
  );

  const parsedShowId =
    parsePositiveInteger(
      showTmdbId,
      "show ID"
    );

  const parsedSeasonNumber =
    parseSeasonNumber(
      seasonNumber
    );

  const parsedEpisodeNumber =
    parsePositiveInteger(
      episodeNumber,
      "episode number"
    );

  if (
    !VALID_LOG_METHODS.has(
      logMethod
    )
  ) {
    throw new TVLogServiceError(
      "Invalid TV log method",
      {
        statusCode: 400,
        code: "INVALID_LOG_METHOD",
      }
    );
  }

  if (
    !VALID_SOURCES.has(
      source
    )
  ) {
    throw new TVLogServiceError(
      "Invalid TV log source",
      {
        statusCode: 400,
        code: "INVALID_LOG_SOURCE",
      }
    );
  }

  const {
    show,
    episode,
  } = await resolveEpisodeMetadata({
    showTmdbId:
      parsedShowId,

    seasonNumber:
      parsedSeasonNumber,

    episodeNumber:
      parsedEpisodeNumber,

    syncIfMissing:
      true,
  });

  if (
    !allowUnaired &&
    source !==
      "tv_time_import" &&
    source !==
      "scene_import" &&
    !isEpisodeAired(
      episode
    )
  ) {
    throw new TVLogServiceError(
      "This episode has not aired yet",
      {
        statusCode: 409,
        code: "EPISODE_NOT_AIRED",

        details: {
          airDate:
            episode.airDate ||
            null,
        },
      }
    );
  }

  const [
    watchNumber,
    resolvedArtwork,
  ] = await Promise.all([
    getNextWatchNumber({
      userId,

      showTmdbId:
        parsedShowId,

      seasonNumber:
        parsedSeasonNumber,

      episodeNumber:
        parsedEpisodeNumber,
    }),

    resolveSavedArtwork({
      userId,

      showTmdbId:
        parsedShowId,

      seasonNumber:
        parsedSeasonNumber,

      episodeNumber:
        parsedEpisodeNumber,

      input,
    }),
  ]);

  const resolvedInput = {
    ...input,

    customShowPoster:
      resolvedArtwork
        .customShowPoster,

    customEpisodeBackdrop:
      resolvedArtwork
        .customEpisodeBackdrop,
  };

  const payload =
    buildTVLogPayload({
      userId,
      show,
      episode,

      input:
        resolvedInput,

      watchNumber,
      logMethod,
      source,
    });

  let log;

  try {
    log =
      await TVLog.create(
        payload
      );
  } catch (error) {
    if (
      error?.code ===
        11000 &&
      payload.externalImportId
    ) {
      throw new TVLogServiceError(
        "This imported watch already exists",
        {
          statusCode: 409,
          code: "DUPLICATE_IMPORTED_LOG",
        }
      );
    }

    throw error;
  }

  const progress =
    await rebuildUserShowProgress(
      userId,
      parsedShowId
    );

  return {
    log,
    progress,
  };
}

// ======================================================
// Quick eye log
// ======================================================

async function createQuickEpisodeLog({
  userId,
  showTmdbId,
  seasonNumber,
  episodeNumber,
  watchedAt = null,
}) {
  return createEpisodeLog({
    userId,
    showTmdbId,
    seasonNumber,
    episodeNumber,

    input: {
      watchedAt,
    },

    logMethod:
      "quick",

    source:
      "manual",
  });
}

// ======================================================
// Bulk season watch
// ======================================================

async function bulkLogAiredSeasonEpisodes({
  userId,
  showTmdbId,
  seasonNumber,
  watchedAt = null,
}) {
  requireValidUserId(
    userId
  );

  const parsedShowId =
    parsePositiveInteger(
      showTmdbId,
      "show ID"
    );

  const parsedSeasonNumber =
    parseSeasonNumber(
      seasonNumber
    );

  await syncSeasonFromTMDB(
    parsedShowId,
    parsedSeasonNumber,
    {
      syncEpisodes: true,
    }
  );

  const episodes =
    await Episode.find({
      showTmdbId:
        parsedShowId,

      seasonNumber:
        parsedSeasonNumber,

      airDate: {
        $ne: null,
        $lte: new Date(),
      },
    })
      .sort({
        episodeNumber: 1,
      })
      .lean();

  if (
    episodes.length === 0
  ) {
    throw new TVLogServiceError(
      "No aired episodes found for this season",
      {
        statusCode: 404,
        code: "NO_AIRED_EPISODES",
      }
    );
  }

  const watchedEpisodeNumbers =
    await TVLog.distinct(
      "episodeNumber",
      {
        user:
          userId,

        showTmdbId:
          parsedShowId,

        seasonNumber:
          parsedSeasonNumber,
      }
    );

  const watchedSet =
    new Set(
      watchedEpisodeNumbers.map(
        Number
      )
    );

  const episodesToCreate =
    episodes.filter(
      (episode) =>
        !watchedSet.has(
          Number(
            episode.episodeNumber
          )
        )
    );

  if (
    episodesToCreate.length === 0
  ) {
    const progress =
      await rebuildUserShowProgress(
        userId,
        parsedShowId
      );

    return {
      createdCount: 0,

      skippedCount:
        episodes.length,

      createdLogs: [],

      progress,
    };
  }

  const [
    show,
    bulkArtwork,
  ] = await Promise.all([
    Show.findOne({
      tmdbId:
        parsedShowId,
    }),

    resolveBulkSeasonArtwork({
      userId,

      showTmdbId:
        parsedShowId,

      seasonNumber:
        parsedSeasonNumber,
    }),
  ]);

  if (!show) {
    throw new TVLogServiceError(
      "Show metadata not found",
      {
        statusCode: 404,
        code: "SHOW_NOT_FOUND",
      }
    );
  }

  const bulkWatchedAt =
    normalizeOptionalDate(
      watchedAt
    ) ||
    new Date();

  const documents =
    episodesToCreate.map(
      (episode) => {
        const episodeNumberValue =
          Number(
            episode.episodeNumber
          );

        return buildTVLogPayload({
          userId,
          show,
          episode,

          input: {
            watchedAt:
              bulkWatchedAt,

            customShowPoster:
              bulkArtwork
                .customShowPoster,

            customEpisodeBackdrop:
              bulkArtwork
                .backdropByEpisodeNumber
                .get(
                  episodeNumberValue
                ) || "",
          },

          watchNumber:
            1,

          logMethod:
            "bulk_season",

          source:
            "manual",
        });
      }
    );

  const createdLogs =
    await TVLog.insertMany(
      documents,
      {
        ordered: true,
      }
    );

  const progress =
    await rebuildUserShowProgress(
      userId,
      parsedShowId
    );

  return {
    createdCount:
      createdLogs.length,

    skippedCount:
      episodes.length -
      createdLogs.length,

    createdLogs,

    progress,
  };
}

// ======================================================
// Edit one log
// ======================================================

async function updateEpisodeLog({
  userId,
  logId,
  updates = {},
}) {
  requireValidUserId(
    userId
  );

  if (
    !mongoose.isValidObjectId(
      logId
    )
  ) {
    throw new TVLogServiceError(
      "Invalid log ID",
      {
        statusCode: 400,
        code: "INVALID_LOG_ID",
      }
    );
  }

  const log =
    await TVLog.findOne({
      _id:
        logId,

      user:
        userId,
    });

  if (!log) {
    throw new TVLogServiceError(
      "TV log not found",
      {
        statusCode: 404,
        code: "TV_LOG_NOT_FOUND",
      }
    );
  }

  const originalWatchedAt =
    log.watchedAt;

  if (
    hasOwn(
      updates,
      "rating"
    )
  ) {
    log.rating =
      normalizeRating(
        updates.rating
      );
  }

  if (
    hasOwn(
      updates,
      "review"
    )
  ) {
    log.review =
      normalizeString(
        updates.review,
        20000
      );
  }

  if (
    hasOwn(
      updates,
      "containsSpoilers"
    )
  ) {
    log.containsSpoilers =
      updates
        .containsSpoilers ===
      true;
  }

  if (
    hasOwn(
      updates,
      "watchedAt"
    )
  ) {
    const watchedAt =
      normalizeOptionalDate(
        updates.watchedAt
      );

    if (!watchedAt) {
      throw new TVLogServiceError(
        "Watch date cannot be empty",
        {
          statusCode: 400,
          code: "WATCH_DATE_REQUIRED",
        }
      );
    }

    log.watchedAt =
      watchedAt;
  }

  if (
    hasOwn(
      updates,
      "customEpisodeBackdrop"
    )
  ) {
    log.customEpisodeBackdrop =
      normalizeString(
        updates
          .customEpisodeBackdrop,
        2000
      );
  }

  if (
    hasOwn(
      updates,
      "customShowPoster"
    )
  ) {
    log.customShowPoster =
      normalizeString(
        updates
          .customShowPoster,
        2000
      );
  }

  if (
    hasOwn(
      updates,
      "gif"
    )
  ) {
    log.gif =
      normalizeString(
        updates.gif,
        2000
      );
  }

  if (
    hasOwn(
      updates,
      "image"
    )
  ) {
    log.image =
      normalizeString(
        updates.image,
        2000
      );
  }

  if (
    hasOwn(
      updates,
      "images"
    )
  ) {
    log.images =
      normalizeImages(
        updates.images
      );
  }

  if (
    hasOwn(
      updates,
      "favoriteCharacter"
    )
  ) {
    log.favoriteCharacter =
      normalizeFavoriteCharacter(
        updates
          .favoriteCharacter
      );
  }

  await log.save();

  const watchedAtChanged =
    new Date(
      originalWatchedAt
    ).getTime() !==
    new Date(
      log.watchedAt
    ).getTime();

  if (watchedAtChanged) {
    await renumberEpisodeWatchHistory({
      userId,

      showTmdbId:
        log.showTmdbId,

      seasonNumber:
        log.seasonNumber,

      episodeNumber:
        log.episodeNumber,
    });
  }

  const refreshedLog =
    await TVLog.findById(
      log._id
    );

  const progress =
    await rebuildUserShowProgress(
      userId,
      log.showTmdbId
    );

  return {
    log:
      refreshedLog,

    progress,
  };
}

// ======================================================
// Delete one log
// ======================================================

async function deleteEpisodeLog({
  userId,
  logId,
}) {
  requireValidUserId(
    userId
  );

  if (
    !mongoose.isValidObjectId(
      logId
    )
  ) {
    throw new TVLogServiceError(
      "Invalid log ID",
      {
        statusCode: 400,
        code: "INVALID_LOG_ID",
      }
    );
  }

  const log =
    await TVLog.findOne({
      _id:
        logId,

      user:
        userId,
    });

  if (!log) {
    throw new TVLogServiceError(
      "TV log not found",
      {
        statusCode: 404,
        code: "TV_LOG_NOT_FOUND",
      }
    );
  }

  const identity = {
    showTmdbId:
      log.showTmdbId,

    seasonNumber:
      log.seasonNumber,

    episodeNumber:
      log.episodeNumber,
  };

  await log.deleteOne();

  const remainingLogs =
    await renumberEpisodeWatchHistory({
      userId,
      ...identity,
    });

  const progress =
    await rebuildUserShowProgress(
      userId,
      identity.showTmdbId
    );

  return {
    deletedLogId:
      logId,

    remainingWatchCount:
      remainingLogs.length,

    progress,
  };
}

// ======================================================
// Delete all history for one episode
// ======================================================

async function deleteEpisodeHistory({
  userId,
  showTmdbId,
  seasonNumber,
  episodeNumber,
}) {
  requireValidUserId(
    userId
  );

  const parsedShowId =
    parsePositiveInteger(
      showTmdbId,
      "show ID"
    );

  const parsedSeasonNumber =
    parseSeasonNumber(
      seasonNumber
    );

  const parsedEpisodeNumber =
    parsePositiveInteger(
      episodeNumber,
      "episode number"
    );

  const result =
    await TVLog.deleteMany(
      getEpisodeIdentityFilter({
        userId,

        showTmdbId:
          parsedShowId,

        seasonNumber:
          parsedSeasonNumber,

        episodeNumber:
          parsedEpisodeNumber,
      })
    );

  const progress =
    await rebuildUserShowProgress(
      userId,
      parsedShowId
    );

  return {
    deletedCount:
      result.deletedCount ||
      0,

    progress,
  };
}

// ======================================================
// Read one user's episode history
// ======================================================

async function getEpisodeWatchHistory({
  userId,
  showTmdbId,
  seasonNumber,
  episodeNumber,
}) {
  requireValidUserId(
    userId
  );

  const parsedShowId =
    parsePositiveInteger(
      showTmdbId,
      "show ID"
    );

  const parsedSeasonNumber =
    parseSeasonNumber(
      seasonNumber
    );

  const parsedEpisodeNumber =
    parsePositiveInteger(
      episodeNumber,
      "episode number"
    );

  const logs =
    await TVLog.find(
      getEpisodeIdentityFilter({
        userId,

        showTmdbId:
          parsedShowId,

        seasonNumber:
          parsedSeasonNumber,

        episodeNumber:
          parsedEpisodeNumber,
      })
    )
      .sort({
        watchNumber: -1,
        watchedAt: -1,
        createdAt: -1,
      })
      .populate(
        "replies.user",
        "username name avatar"
      )
      .lean({
        virtuals: true,
      });

  return {
    totalWatchCount:
      logs.length,

    rewatchCount:
      Math.max(
        0,
        logs.length - 1
      ),

    latestLog:
      logs[0] ||
      null,

    logs,
  };
}

// ======================================================
// Read one log
// ======================================================

async function getEpisodeLogById({
  logId,
  userId = null,
}) {
  if (
    !mongoose.isValidObjectId(
      logId
    )
  ) {
    throw new TVLogServiceError(
      "Invalid log ID",
      {
        statusCode: 400,
        code: "INVALID_LOG_ID",
      }
    );
  }

  const query = {
    _id:
      logId,
  };

  if (userId) {
    requireValidUserId(
      userId
    );

    query.user =
      userId;
  }

  const log =
    await TVLog.findOne(
      query
    )
      .populate(
        "user",
        "username name avatar"
      )
      .populate(
        "replies.user",
        "username name avatar"
      )
      .lean({
        virtuals: true,
      });

  if (!log) {
    throw new TVLogServiceError(
      "TV log not found",
      {
        statusCode: 404,
        code: "TV_LOG_NOT_FOUND",
      }
    );
  }

  return log;
}

// ======================================================
// Latest log for a user/episode
// ======================================================

async function getLatestEpisodeLog({
  userId,
  showTmdbId,
  seasonNumber,
  episodeNumber,
}) {
  requireValidUserId(
    userId
  );

  const parsedShowId =
    parsePositiveInteger(
      showTmdbId,
      "show ID"
    );

  const parsedSeasonNumber =
    parseSeasonNumber(
      seasonNumber
    );

  const parsedEpisodeNumber =
    parsePositiveInteger(
      episodeNumber,
      "episode number"
    );

  return TVLog.findOne(
    getEpisodeIdentityFilter({
      userId,

      showTmdbId:
        parsedShowId,

      seasonNumber:
        parsedSeasonNumber,

      episodeNumber:
        parsedEpisodeNumber,
    })
  )
    .sort({
      watchedAt: -1,
      createdAt: -1,
    })
    .populate(
      "replies.user",
      "username name avatar"
    )
    .lean({
      virtuals: true,
    });
}

// ======================================================
// Export
// ======================================================

module.exports = {
  TVLogServiceError,

  createEpisodeLog,
  createQuickEpisodeLog,
  bulkLogAiredSeasonEpisodes,

  updateEpisodeLog,
  deleteEpisodeLog,
  deleteEpisodeHistory,

  getEpisodeWatchHistory,
  getEpisodeLogById,
  getLatestEpisodeLog,

  getNextWatchNumber,
  renumberEpisodeWatchHistory,

  resolveSavedArtwork,
  resolveBulkSeasonArtwork,

  hasReviewContent,
};
