// src/routes/tvTimeImportRoutes.js

const express = require("express");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const AdmZip = require("adm-zip");
const Papa = require("papaparse");

const protect = require(
  "../middleware/authMiddleware"
);

const TVImportJob = require(
  "../models/tvImportJob"
);

const Episode = require(
  "../models/episodeModel"
);

const {
  searchTVShows,
  getTVShowDetails,
  findTVEpisodesByExternalId,
  syncSeasonFromTMDB,
  syncEpisodeFromTMDB,
} = require(
  "../services/tvMetadataService"
);

const TVLog = require("../models/tvLog");
const Show = require("../models/showModel");
const User = require("../models/user");
const UserShowProgress = require("../models/userShowProgress");
const {
  rebuildAllUserShowProgress,
} = require("../services/tvProgressService");

const router = express.Router();

const MAX_ZIP_SIZE =
  30 * 1024 * 1024;

const MAX_UNCOMPRESSED_SIZE =
  100 * 1024 * 1024;

const MAX_ARCHIVE_ENTRIES =
  250;

const MAX_ROWS_PER_CSV =
  100000;

const upload = multer({
  storage:
    multer.memoryStorage(),

  limits: {
    fileSize:
      MAX_ZIP_SIZE,

    /*
     * build-plan receives the complete resolved episode array
     * as one multipart text field.
     */
    fieldSize:
      20 * 1024 * 1024,

    fields:
      10,

    files:
      1,
  },

  fileFilter(
    req,
    file,
    callback
  ) {
    const extension =
      path
        .extname(
          file.originalname ||
          ""
        )
        .toLowerCase();

    const allowedMimeTypes =
      new Set([
        "application/zip",
        "application/x-zip-compressed",
        "application/octet-stream",
        "multipart/x-zip",
      ]);

    if (
      extension === ".zip" &&
      allowedMimeTypes.has(
        file.mimetype
      )
    ) {
      return callback(
        null,
        true
      );
    }

    const error =
      new Error(
        "Please upload the original TV Time ZIP export."
      );

    error.code =
      "INVALID_TV_TIME_ARCHIVE";

    return callback(
      error
    );
  },
});

function normalizeBoolean(
  value
) {
  if (
    value === true ||
    value === false
  ) {
    return value;
  }

  if (
    value === null ||
    value === undefined
  ) {
    return false;
  }

  const normalized =
    String(value)
      .trim()
      .toLowerCase();

  return [
    "true",
    "1",
    "yes",
    "y",
    "on",
  ].includes(
    normalized
  );
}

function parseDateValue(
  value
) {
  if (
    value instanceof Date
  ) {
    return Number.isNaN(
      value.getTime()
    )
      ? null
      : value;
  }

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const raw =
    String(value)
      .trim();

  if (!raw) {
    return null;
  }

  /*
   * Support Unix timestamps exported in either seconds
   * or milliseconds.
   */
  if (
    /^\d+$/.test(
      raw
    )
  ) {
    const numeric =
      Number(raw);

    if (
      Number.isFinite(
        numeric
      )
    ) {
      const milliseconds =
        numeric < 100000000000
          ? numeric * 1000
          : numeric;

      const numericDate =
        new Date(
          milliseconds
        );

      if (
        !Number.isNaN(
          numericDate.getTime()
        )
      ) {
        return numericDate;
      }
    }
  }

  /*
   * TV Time commonly exports:
   * YYYY-MM-DD HH:mm:ss
   *
   * Treat it consistently as UTC rather than allowing
   * the server timezone to shift imported watch dates.
   */
  const normalized =
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(
      raw
    )
      ? raw.replace(
          " ",
          "T"
        ) + "Z"
      : raw;

  const parsed =
    new Date(
      normalized
    );

  if (
    Number.isNaN(
      parsed.getTime()
    )
  ) {
    return null;
  }

  return parsed;
}

function cleanString(
  value,
  maximumLength = 500
) {
  return String(
    value ?? ""
  )
    .replace(/^\uFEFF/, "")
    .trim()
    .slice(
      0,
      maximumLength
    );
}

function normalizeFileName(
  value
) {
  return path
    .basename(
      String(
        value ||
        ""
      )
    )
    .toLowerCase()
    .trim();
}

function normalizeTitle(
  value
) {
  return cleanString(
    value,
    500
  )
    .toLowerCase()
    .normalize("NFKD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /[^a-z0-9\u0600-\u06ff]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function toBoolean(
  value
) {
  if (
    value === true ||
    value === 1
  ) {
    return true;
  }

  const normalized =
    cleanString(
      value,
      30
    ).toLowerCase();

  return [
    "1",
    "true",
    "yes",
    "y",
    "active",
  ].includes(
    normalized
  );
}

function toNonNegativeInteger(
  value
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(
      number
    ) ||
    number < 0
  ) {
    return 0;
  }

  return Math.floor(
    number
  );
}

function hasValidDate(
  value
) {
  if (!value) {
    return false;
  }

  const date =
    new Date(value);

  return !Number.isNaN(
    date.getTime()
  );
}

function firstValue(
  row,
  keys
) {
  for (
    const key of keys
  ) {
    const value =
      row?.[key];

    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
    ) {
      return value;
    }
  }

  return "";
}

function showNameFromRow(
  row
) {
  return cleanString(
    firstValue(
      row,
      [
        "series_name",
        "tv_show_name",
        "show_name",
        "name",
      ]
    ),
    500
  );
}

function seasonNumberFromRow(
  row
) {
  return toNonNegativeInteger(
    firstValue(
      row,
      [
        "season_number",
        "episode_season_number",
        "s_no",
      ]
    )
  );
}

function episodeNumberFromRow(
  row
) {
  return toNonNegativeInteger(
    firstValue(
      row,
      [
        "episode_number",
        "ep_no",
      ]
    )
  );
}

function episodeIdFromRow(
  row
) {
  return cleanString(
    firstValue(
      row,
      [
        "episode_id",
        "ep_id",
        "uuid",
        "entity_uuid",
      ]
    ),
    200
  );
}

function showIdFromRow(
  row
) {
  return cleanString(
    firstValue(
      row,
      [
        "tv_show_id",
        "series_id",
        "s_id",
        "series_uuid",
      ]
    ),
    200
  );
}

function makeShowKey(
  row
) {
  const showName =
    showNameFromRow(
      row
    );

  const showId =
    showIdFromRow(
      row
    );

  if (showId) {
    return `id:${showId}`;
  }

  if (showName) {
    return (
      `name:${normalizeTitle(
        showName
      )}`
    );
  }

  return "";
}

function isWatchedEpisodeRow(
  row
) {
  if (
    !row ||
    typeof row !== "object"
  ) {
    return false;
  }

  const sourceEpisodeId =
    firstValue(
      row,
      [
        "episode_id",
        "ep_id",
      ]
    );

  const key =
    cleanString(
      firstValue(
        row,
        [
          "key",
        ]
      ),
      500
    );

  /*
   * Genuine TV Time watch records have both:
   *
   * - a source episode ID;
   * - a watch-episode-* key.
   *
   * Do not require a valid SxE position here. A few real
   * records contain episode_number=0 and must be preserved
   * for manual recovery rather than silently discarded.
   */
  return Boolean(
    sourceEpisodeId
  ) &&
    key.startsWith(
      "watch-episode-"
    );
}

function makeEpisodeKey(
  row
) {
  if (
    !isWatchedEpisodeRow(
      row
    )
  ) {
    return "";
  }

  const episodeId =
    episodeIdFromRow(
      row
    );

  if (episodeId) {
    return (
      `episode:${episodeId}`
    );
  }

  const showKey =
    makeShowKey(
      row
    );

  const seasonNumber =
    seasonNumberFromRow(
      row
    );

  const episodeNumber =
    episodeNumberFromRow(
      row
    );

  if (
    showKey &&
    episodeNumber > 0
  ) {
    return (
      `${showKey}:s${seasonNumber}:e${episodeNumber}`
    );
  }

  return "";
}

function parseCsvBuffer(
  buffer,
  fileName
) {
  const csv =
    buffer.toString(
      "utf-8"
    );

  const parsed =
    Papa.parse(
      csv,
      {
        header:
          true,

        skipEmptyLines:
          "greedy",

        transformHeader:
          (header) =>
            cleanString(
              header,
              200
            ),
      }
    );

  const seriousError =
    Array.isArray(
      parsed.errors
    )
      ? parsed.errors.find(
          (error) =>
            error?.type ===
              "Quotes" ||
            error?.type ===
              "Delimiter"
        )
      : null;

  if (seriousError) {
    const error =
      new Error(
        `Could not parse ${fileName}`
      );

    error.code =
      "TV_TIME_CSV_PARSE_FAILED";

    throw error;
  }

  const allRows =
    Array.isArray(
      parsed.data
    )
      ? parsed.data
      : [];

  return {
    rows:
      allRows.slice(
        0,
        MAX_ROWS_PER_CSV
      ),

    totalRows:
      allRows.length,

    truncated:
      allRows.length >
      MAX_ROWS_PER_CSV,

    fields:
      Array.isArray(
        parsed.meta?.fields
      )
        ? parsed.meta.fields
        : [],
  };
}

function readTVTimeArchive(
  file
) {
  if (!file?.buffer) {
    const error =
      new Error(
        "No ZIP file uploaded."
      );

    error.code =
      "NO_TV_TIME_ARCHIVE";

    throw error;
  }

  let archive;

  try {
    archive =
      new AdmZip(
        file.buffer
      );
  } catch (error) {
    const invalidError =
      new Error(
        "The uploaded file is not a valid ZIP archive."
      );

    invalidError.code =
      "INVALID_TV_TIME_ARCHIVE";

    throw invalidError;
  }

  const entries =
    archive
      .getEntries()
      .filter(
        (entry) =>
          !entry.isDirectory
      );

  if (
    entries.length === 0
  ) {
    const error =
      new Error(
        "The ZIP archive is empty."
      );

    error.code =
      "EMPTY_TV_TIME_ARCHIVE";

    throw error;
  }

  if (
    entries.length >
    MAX_ARCHIVE_ENTRIES
  ) {
    const error =
      new Error(
        "The ZIP archive contains too many files."
      );

    error.code =
      "TV_TIME_ARCHIVE_TOO_LARGE";

    throw error;
  }

  let totalUncompressedBytes =
    0;

  const csvFiles =
    new Map();

  for (
    const entry of entries
  ) {
    const name =
      normalizeFileName(
        entry.entryName
      );

    const size =
      Number(
        entry.header?.size ||
        0
      );

    totalUncompressedBytes +=
      Math.max(
        0,
        size
      );

    if (
      totalUncompressedBytes >
      MAX_UNCOMPRESSED_SIZE
    ) {
      const error =
        new Error(
          "The extracted TV Time archive is too large."
        );

      error.code =
        "TV_TIME_ARCHIVE_TOO_LARGE";

      throw error;
    }

    if (
      !name.endsWith(
        ".csv"
      )
    ) {
      continue;
    }

    const buffer =
      entry.getData();

    csvFiles.set(
      name,
      {
        name,
        originalName:
          entry.entryName,

        buffer,
      }
    );
  }

  if (
    csvFiles.size === 0
  ) {
    const error =
      new Error(
        "No CSV files were found inside this ZIP archive."
      );

    error.code =
      "NO_TV_TIME_CSV_FILES";

    throw error;
  }

  return {
    entries,
    csvFiles,
    totalUncompressedBytes,
  };
}

function parseAvailableFiles(
  csvFiles
) {
  const parsedFiles =
    new Map();

  const warnings =
    [];

  for (
    const [
      fileName,
      file,
    ] of csvFiles.entries()
  ) {
    try {
      const parsed =
        parseCsvBuffer(
          file.buffer,
          fileName
        );

      parsedFiles.set(
        fileName,
        parsed
      );

      if (
        parsed.truncated
      ) {
        warnings.push({
          code:
            "CSV_ROWS_TRUNCATED",

          message:
            `${fileName} exceeded the analyzer row limit.`,

          count:
            parsed.totalRows -
            parsed.rows.length,
        });
      }
    } catch (error) {
      warnings.push({
        code:
          error.code ||
          "CSV_PARSE_FAILED",

        message:
          error.message ||
          `Could not parse ${fileName}.`,

        count:
          1,
      });
    }
  }

  return {
    parsedFiles,
    warnings,
  };
}

function rowsFromFiles(
  parsedFiles,
  fileNames
) {
  const rows =
    [];

  for (
    const fileName of fileNames
  ) {
    const parsed =
      parsedFiles.get(
        fileName
      );

    if (
      Array.isArray(
        parsed?.rows
      )
    ) {
      rows.push(
        ...parsed.rows
      );
    }
  }

  return rows;
}


function rowsWithSourceFiles(
  parsedFiles,
  fileNames
) {
  const rows =
    [];

  for (
    const fileName of fileNames
  ) {
    const parsed =
      parsedFiles.get(
        fileName
      );

    if (
      !Array.isArray(
        parsed?.rows
      )
    ) {
      continue;
    }

    for (
      const row of parsed.rows
    ) {
      rows.push({
        row,
        sourceFile:
          fileName,
      });
    }
  }

  return rows;
}

function countTVTimeData(
  parsedFiles
) {
  const trackingRows =
    rowsFromFiles(
      parsedFiles,
      [
        "tracking-prod-records-v2.csv",
      ]
    );

  const legacyTrackingRows =
    rowsFromFiles(
      parsedFiles,
      [
        "tracking-prod-records.csv",
      ]
    );

  const followedRows =
    rowsFromFiles(
      parsedFiles,
      [
        "followed_tv_show.csv",
        "user_tv_show_data.csv",
      ]
    );

  const ratingRows =
    rowsFromFiles(
      parsedFiles,
      [
        "ratings-3-prod-episode_votes.csv",
        "ratings-v2-prod-votes.csv",
        "ratings-prod-episode_votes.csv",
        "ratings-live-votes.csv",
      ]
    );

  const characterRows =
    rowsFromFiles(
      parsedFiles,
      [
        "show_character_episode_vote.csv",
      ]
    );

  const dedicatedRewatchRows =
    rowsFromFiles(
      parsedFiles,
      [
        "rewatched_episode.csv",
      ]
    );

  const listRows =
    rowsFromFiles(
      parsedFiles,
      [
        "lists-prod-lists.csv",
      ]
    );

  const commentRows =
    rowsFromFiles(
      parsedFiles,
      [
        "comments-prod-comments.csv",
      ]
    );

  const showKeys =
    new Set();

  const episodeKeys =
    new Set();

  const watchDateKeys =
    new Set();

  const watchLaterShowKeys =
    new Set();

  const favoriteShowKeys =
    new Set();

  const followedShowKeys =
    new Set();

  for (
    const row of [
      ...trackingRows,
      ...followedRows,
    ]
  ) {
    const showKey =
      makeShowKey(
        row
      );

    if (showKey) {
      showKeys.add(
        showKey
      );
    }
  }

  for (
    const row of trackingRows
  ) {
    const episodeKey =
      makeEpisodeKey(
        row
      );

    if (episodeKey) {
      episodeKeys.add(
        episodeKey
      );

      const watchedDate =
        firstValue(
          row,
          [
            "created_at",
            "updated_at",
            "followed_at",
          ]
        );

      if (
        hasValidDate(
          watchedDate
        )
      ) {
        watchDateKeys.add(
          episodeKey
        );
      }
    }

    if (
      toBoolean(
        row.is_for_later
      )
    ) {
      const showKey =
        makeShowKey(
          row
        );

      if (showKey) {
        watchLaterShowKeys.add(
          showKey
        );
      }
    }

    if (
      toBoolean(
        row.is_followed
      )
    ) {
      const showKey =
        makeShowKey(
          row
        );

      if (showKey) {
        followedShowKeys.add(
          showKey
        );
      }
    }
  }

  /*
   * Legacy rows may use a different UUID/key for an episode.
   * Only use them to fill a missing date when the episode can
   * be matched to one of the modern watched-episode records.
   */
  const modernEpisodeByIdentity =
    new Map();

  for (
    const row of trackingRows
  ) {
    const showName =
      normalizeTitle(
        showNameFromRow(
          row
        )
      );

    const seasonNumber =
      seasonNumberFromRow(
        row
      );

    const episodeNumber =
      episodeNumberFromRow(
        row
      );

    const episodeKey =
      makeEpisodeKey(
        row
      );

    if (
      showName &&
      episodeNumber > 0 &&
      episodeKey
    ) {
      modernEpisodeByIdentity.set(
        `${showName}:s${seasonNumber}:e${episodeNumber}`,
        episodeKey
      );
    }
  }

  for (
    const row of legacyTrackingRows
  ) {
    const showName =
      normalizeTitle(
        showNameFromRow(
          row
        )
      );

    const seasonNumber =
      seasonNumberFromRow(
        row
      );

    const episodeNumber =
      episodeNumberFromRow(
        row
      );

    const identity =
      `${showName}:s${seasonNumber}:e${episodeNumber}`;

    const modernEpisodeKey =
      modernEpisodeByIdentity.get(
        identity
      );

    if (
      modernEpisodeKey &&
      hasValidDate(
        firstValue(
          row,
          [
            "watch_date",
            "created_at",
          ]
        )
      )
    ) {
      watchDateKeys.add(
        modernEpisodeKey
      );
    }
  }

  for (
    const row of followedRows
  ) {
    const showKey =
      makeShowKey(
        row
      );

    if (!showKey) {
      continue;
    }

    if (
      toBoolean(
        row.is_favorited
      )
    ) {
      favoriteShowKeys.add(
        showKey
      );
    }

    if (
      toBoolean(
        row.is_followed
      ) ||
      toBoolean(
        row.active
      )
    ) {
      followedShowKeys.add(
        showKey
      );
    }
  }

  const ratingKeys =
    new Set();

  for (
    const row of ratingRows
  ) {
    const episodeId =
      cleanString(
        row.episode_id,
        200
      );

    const showName =
      showNameFromRow(
        row
      );

    const seasonNumber =
      seasonNumberFromRow(
        row
      );

    const episodeNumber =
      episodeNumberFromRow(
        row
      );

    /*
     * TV Time mixes movie votes into some historical rating
     * files. A recoverable TV rating must identify a real
     * episode and a show.
     */
    if (
      episodeId &&
      episodeId !== "0" &&
      showName
    ) {
      ratingKeys.add(
        `episode:${episodeId}`
      );

      continue;
    }

    if (
      showName &&
      episodeNumber > 0
    ) {
      ratingKeys.add(
        `show:${normalizeTitle(
          showName
        )}:s${seasonNumber}:e${episodeNumber}`
      );
    }
  }

  const characterVoteKeys =
    new Set();

  for (
    const row of characterRows
  ) {
    const episodeKey =
      makeEpisodeKey(
        row
      );

    const characterId =
      cleanString(
        row.show_character_id,
        200
      );

    const key =
      `${episodeKey}:${characterId}`;

    if (
      episodeKey &&
      characterId
    ) {
      characterVoteKeys.add(
        key
      );
    }
  }

  let trackingRewatchTotal =
    0;

  for (
    const row of trackingRows
  ) {
    trackingRewatchTotal +=
      toNonNegativeInteger(
        row.rewatch_count
      );
  }

  let dedicatedRewatchTotal =
    0;

  for (
    const row of dedicatedRewatchRows
  ) {
    dedicatedRewatchTotal +=
      Math.max(
        1,
        toNonNegativeInteger(
          row.cpt
        )
      );
  }

  /*
   * These two files may describe the same rewatch.
   * Use the larger total rather than adding both.
   */
  const rewatches =
    Math.max(
      trackingRewatchTotal,
      dedicatedRewatchTotal
    );

  const recoverableCommentBodies =
    commentRows.filter(
      (row) =>
        Boolean(
          cleanString(
            firstValue(
              row,
              [
                "text",
                "body",
                "content",
                "message",
                "comment",
                "review",
              ]
            ),
            10000
          )
        )
    ).length;

  return {
    shows:
      showKeys.size,

    followedShows:
      followedShowKeys.size,

    watchedEpisodes:
      episodeKeys.size,

    watchDates:
      watchDateKeys.size,

    rewatches,

    episodeRatings:
      ratingKeys.size,

    favoriteCharacterVotes:
      characterVoteKeys.size,

    watchLaterShows:
      watchLaterShowKeys.size,

    favoriteShows:
      favoriteShowKeys.size,

    lists:
      listRows.length,

    commentRecords:
      commentRows.length,

    recoverableCommentBodies,
  };
}

function buildFileReport(
  parsedFiles
) {
  return Array.from(
    parsedFiles.entries()
  )
    .map(
      ([
        fileName,
        parsed,
      ]) => ({
        fileName,

        rows:
          parsed.totalRows,

        analyzedRows:
          parsed.rows.length,

        truncated:
          parsed.truncated,

        columns:
          parsed.fields,
      })
    )
    .sort(
      (left, right) =>
        left.fileName.localeCompare(
          right.fileName
        )
    );
}

function buildWarnings(
  summary,
  parseWarnings
) {
  const warnings = [
    ...parseWarnings,
  ];

  if (
    summary.commentRecords > 0 &&
    summary.recoverableCommentBodies === 0
  ) {
    warnings.push({
      code:
        "COMMENT_TEXT_NOT_EXPORTED",

      message:
        "TV Time included comment records but did not include their written text.",

      count:
        summary.commentRecords,
    });
  }

  if (
    summary.watchedEpisodes === 0
  ) {
    warnings.push({
      code:
        "NO_WATCHED_EPISODES_FOUND",

      message:
        "No watched episode history was detected in this archive.",

      count:
        1,
    });
  }

  return warnings;
}

function serializeJob(
  job
) {
  return {
    id:
      String(
        job._id
      ),

    status:
      job.status,

    source:
      job.source,

    importVersion:
      job.importVersion,

    progressPercentage:
      job.progressPercentage,

    currentStage:
      job.currentStage,

    createdAt:
      job.createdAt,

    previewReadyAt:
      job.previewReadyAt,
  };
}

// ========================================================
// POST /api/tv-time-import/analyze
//
// Analysis only. This endpoint never writes TV logs.
// ========================================================

router.post(
  "/analyze",
  protect,
  upload.single("file"),
  async (
    req,
    res,
    next
  ) => {
    let job = null;

    try {
      if (
        !req.file?.buffer
      ) {
        return res
          .status(400)
          .json({
            error:
              "Please select your original TV Time ZIP export.",
          });
      }

      const fileHash =
        crypto
          .createHash(
            "sha256"
          )
          .update(
            req.file.buffer
          )
          .digest(
            "hex"
          );

      job =
        await TVImportJob.findOne({
          user:
            req.user._id,

          source:
            "tv_time",

          fileHash,
        });

      if (!job) {
        job =
          new TVImportJob({
            user:
              req.user._id,

            source:
              "tv_time",

            status:
              "parsing",

            originalFileName:
              cleanString(
                req.file.originalname,
                500
              ),

            mimeType:
              cleanString(
                req.file.mimetype,
                200
              ),

            fileSizeBytes:
              req.file.size ||
              req.file.buffer.length,

            fileHash,

            importVersion:
              1,

            progressPercentage:
              10,

            currentStage:
              "Reading TV Time archive",

            attemptCount:
              1,

            lastAttemptAt:
              new Date(),
          });
      } else {
        job.status =
          "parsing";

        job.progressPercentage =
          10;

        job.currentStage =
          "Re-analyzing TV Time archive";

        job.attemptCount =
          Number(
            job.attemptCount ||
            0
          ) + 1;

        job.lastAttemptAt =
          new Date();

        job.errorCode =
          "";

        job.errorMessage =
          "";

        job.failedStage =
          "";
      }

      await job.save();

      const {
        entries,
        csvFiles,
        totalUncompressedBytes,
      } =
        readTVTimeArchive(
          req.file
        );

      job.progressPercentage =
        45;

      job.currentStage =
        "Reading TV Time CSV files";

      await job.save();

      const {
        parsedFiles,
        warnings:
          parseWarnings,
      } =
        parseAvailableFiles(
          csvFiles
        );

      const summary =
        countTVTimeData(
          parsedFiles
        );

      const warnings =
        buildWarnings(
          summary,
          parseWarnings
        );

      const fileReport =
        buildFileReport(
          parsedFiles
        );

      job.status =
        "preview_ready";

      job.progressPercentage =
        100;

      job.currentStage =
        "Preview ready";

      job.resumeFromStage =
        "archive_analyzed";

      job.stats = {
        ...(
          job.stats?.toObject?.() ||
          job.stats ||
          {}
        ),

        rowsRead:
          fileReport.reduce(
            (
              total,
              file
            ) =>
              total +
              file.analyzedRows,
            0
          ),

        showsDetected:
          summary.shows,

        episodesDetected:
          summary.watchedEpisodes,

        ratingsDetected:
          summary.episodeRatings,

        watchDatesDetected:
          summary.watchDates,

        rewatchesDetected:
          summary.rewatches,

        favoriteCharacterVotesDetected:
          summary.favoriteCharacterVotes,

        watchLaterShowsDetected:
          summary.watchLaterShows,

        favoriteShowsDetected:
          summary.favoriteShows,

        listsDetected:
          summary.lists,

        commentRecordsDetected:
          summary.commentRecords,

        recoverableCommentBodiesDetected:
          summary.recoverableCommentBodies,

        archiveFilesDetected:
          entries.length,

        reviewsDetected:
          summary.recoverableCommentBodies,

        watchlistItemsDetected:
          summary.watchLaterShows,
      };

      job.warnings =
        warnings;

      await job.save();

      return res
        .status(200)
        .json({
          archiveValid:
            true,

          readyForImport:
            summary.watchedEpisodes > 0 ||
            summary.watchLaterShows > 0 ||
            summary.favoriteShows > 0,

          job:
            serializeJob(
              job
            ),

          archive: {
            originalFileName:
              req.file.originalname,

            compressedBytes:
              req.file.size ||
              req.file.buffer.length,

            uncompressedBytes:
              totalUncompressedBytes,

            filesFound:
              entries.length,

            csvFilesFound:
              csvFiles.size,

            parsedCsvFiles:
              parsedFiles.size,
          },

          summary,

          warnings,

          files:
            fileReport,
        });
    } catch (error) {
      console.error(
        "❌ TV Time archive analysis failed:",
        error
      );

      if (job) {
        try {
          job.status =
            "failed";

          job.progressPercentage =
            0;

          job.currentStage =
            "Analysis failed";

          job.errorCode =
            error.code ||
            "TV_TIME_ANALYSIS_FAILED";

          job.errorMessage =
            cleanString(
              error.message,
              1000
            );

          job.failedStage =
            "archive_analysis";

          await job.save();
        } catch (
          jobError
        ) {
          console.error(
            "❌ Failed to update TV import job:",
            jobError
          );
        }
      }

      const knownClientErrors =
        new Set([
          "NO_TV_TIME_ARCHIVE",
          "INVALID_TV_TIME_ARCHIVE",
          "EMPTY_TV_TIME_ARCHIVE",
          "TV_TIME_ARCHIVE_TOO_LARGE",
          "NO_TV_TIME_CSV_FILES",
          "TV_TIME_CSV_PARSE_FAILED",
        ]);

      if (
        knownClientErrors.has(
          error.code
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              error.message,

            code:
              error.code,
          });
      }

      return res
        .status(500)
        .json({
          error:
            "Failed to analyze TV Time data.",

          code:
            "TV_TIME_ANALYSIS_FAILED",
        });
    }
  }
);


// ========================================================
// SHOW RESOLUTION HELPERS
// ========================================================

function sleep(
  milliseconds
) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        milliseconds
      )
  );
}

function cleanTVTimeSearchTitle(
  value
) {
  return String(value || "")
    .replace(
      /\bPLUR1BUS\b/gi,
      "PLURIBUS"
    )
    .replace(
      /\s*[\(\[]\s*(us|usa|uk|au|ca|fr|de|es|it|kr|jp)\s*[\)\]]\s*$/i,
      ""
    )
    .replace(
      /\s*[\(\[]\s*((?:18|19|20)\d{2})\s*[\)\]]\s*$/i,
      ""
    )
    .trim();
}

function normalizeMatchTitle(
  value
) {
  return normalizeTitle(
    cleanTVTimeSearchTitle(
      value
    )
  );
}

function getVersionHint(
  value
) {
  const match =
    String(value || "")
      .trim()
      .match(
        /[\(\[]\s*(us|usa|uk|au|ca|fr|de|es|it|kr|jp)\s*[\)\]]$/i
      );

  if (!match) {
    return "";
  }

  const raw =
    match[1]
      .toUpperCase();

  const aliases = {
    USA: "US",
    UK: "GB",
  };

  return aliases[raw] || raw;
}

function getSourceYearHint(
  value
) {
  const match =
    String(value || "")
      .trim()
      .match(
        /[\(\[]\s*((?:18|19|20)\d{2})\s*[\)\]]$/
      );

  if (!match) {
    return null;
  }

  const year =
    Number(match[1]);

  return Number.isInteger(year)
    ? year
    : null;
}

function getYearFromDate(
  value
) {
  if (!value) {
    return null;
  }

  const year =
    Number(
      String(value)
        .slice(0, 4)
    );

  return Number.isInteger(year)
    ? year
    : null;
}

function similarityScore(
  left,
  right
) {
  const a =
    normalizeMatchTitle(
      left
    );

  const b =
    normalizeMatchTitle(
      right
    );

  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  if (
    a.startsWith(b) ||
    b.startsWith(a)
  ) {
    return 0.88;
  }

  const leftWords =
    new Set(
      a.split(" ")
        .filter(Boolean)
    );

  const rightWords =
    new Set(
      b.split(" ")
        .filter(Boolean)
    );

  const union =
    new Set([
      ...leftWords,
      ...rightWords,
    ]);

  if (!union.size) {
    return 0;
  }

  let intersection = 0;

  for (
    const word of leftWords
  ) {
    if (
      rightWords.has(
        word
      )
    ) {
      intersection += 1;
    }
  }

  return (
    intersection /
    union.size
  );
}

function getSafeTitleOverride(
  sourceName
) {
  const normalized =
    normalizeTitle(
      sourceName
    );

  const safeOverrides = {
    "how i met your mother": {
      tmdbId: 1100,
      reason:
        "Known exact TV Time title mapping.",
    },

    "the leftovers": {
      tmdbId: 54344,
      reason:
        "Known exact TV Time title mapping.",
    },

    "scrubs": {
      tmdbId: 4556,
      reason:
        "Known exact TV Time title mapping.",
    },

    "chernobyl": {
      tmdbId: 87108,
      reason:
        "Known exact TV Time title mapping.",
    },

    "plur1bus": {
      tmdbId: 157239,
      reason:
        "TV Time stylized title maps to Pluribus.",
    },
  };

  return safeOverrides[
    normalized
  ] || null;
}

function candidateScore(
  sourceName,
  candidate
) {
  const candidateName =
    cleanString(
      candidate?.name,
      500
    );

  const originalName =
    cleanString(
      candidate?.original_name,
      500
    );

  const displayedSimilarity =
    similarityScore(
      sourceName,
      candidateName
    );

  const originalSimilarity =
    similarityScore(
      sourceName,
      originalName
    );

  const titleSimilarity =
    Math.max(
      displayedSimilarity,
      originalSimilarity
    );

  let score =
    titleSimilarity * 0.88;

  const versionHint =
    getVersionHint(
      sourceName
    );

  const originCountries =
    Array.isArray(
      candidate?.origin_country
    )
      ? candidate.origin_country
          .map(
            (country) =>
              String(country)
                .toUpperCase()
          )
      : [];

  if (versionHint) {
    if (
      originCountries.includes(
        versionHint
      )
    ) {
      score += 0.09;
    } else if (
      originCountries.length > 0
    ) {
      score -= 0.12;
    }
  }

  if (
    normalizeTitle(
      sourceName
    ) ===
      normalizeTitle(
        candidateName
      ) ||
    normalizeTitle(
      sourceName
    ) ===
      normalizeTitle(
        originalName
      )
  ) {
    score += 0.06;
  }

  const sourceYear =
    getSourceYearHint(
      sourceName
    );

  const candidateYear =
    getYearFromDate(
      candidate?.first_air_date
    );

  if (
    sourceYear &&
    candidateYear
  ) {
    if (
      sourceYear ===
      candidateYear
    ) {
      score += 0.08;
    } else {
      score -= Math.min(
        0.18,
        Math.abs(
          sourceYear -
          candidateYear
        ) * 0.025
      );
    }
  }

  const popularity =
    Number(
      candidate?.popularity
    ) || 0;

  score += Math.min(
    0.025,
    Math.log10(
      popularity + 1
    ) * 0.006
  );

  return Math.max(
    0,
    Math.min(
      1,
      Number(
        score.toFixed(4)
      )
    )
  );
}

function formatResolutionCandidate(
  candidate,
  score
) {
  return {
    tmdbId:
      Number(
        candidate?.id
      ) || null,

    name:
      cleanString(
        candidate?.name,
        500
      ),

    originalName:
      cleanString(
        candidate?.original_name,
        500
      ),

    firstAirDate:
      cleanString(
        candidate?.first_air_date,
        50
      ),

    year:
      getYearFromDate(
        candidate?.first_air_date
      ),

    posterPath:
      candidate?.poster_path ||
      "",

    backdropPath:
      candidate?.backdrop_path ||
      "",

    originCountry:
      Array.isArray(
        candidate?.origin_country
      )
        ? candidate.origin_country
            .map(
              (value) =>
                cleanString(
                  value,
                  10
                )
            )
            .filter(Boolean)
        : [],

    popularity:
      Number(
        candidate?.popularity
      ) || 0,

    score,
  };
}

function extractSourceShows(
  parsedFiles
) {
  const trackingRows =
    rowsFromFiles(
      parsedFiles,
      [
        "tracking-prod-records-v2.csv",
      ]
    );

  const followedRows =
    rowsFromFiles(
      parsedFiles,
      [
        "followed_tv_show.csv",
        "user_tv_show_data.csv",
      ]
    );

  const reportedEpisodesSeenByShowId =
    new Map();

  for (
    const row of followedRows
  ) {
    const showId =
      showIdFromRow(
        row
      );

    const reported =
      Number(
        firstValue(
          row,
          [
            "nb_episodes_seen",
          ]
        )
      );

    if (
      showId &&
      Number.isFinite(
        reported
      ) &&
      reported >= 0
    ) {
      reportedEpisodesSeenByShowId.set(
        showId,
        Math.floor(
          reported
        )
      );
    }
  }

  const sourceMap =
    new Map();

  function ensureSource(
    row
  ) {
    const sourceName =
      showNameFromRow(
        row
      );

    const sourceId =
      showIdFromRow(
        row
      );

    /*
     * Some TV Time records preserve the source show ID but
     * omit the show name entirely. Keep those episodes grouped
     * under an orphan bucket so the user can identify the show
     * during the frontend accuracy check.
     */
    if (
      !sourceName &&
      !sourceId
    ) {
      return null;
    }

    const sourceNameMissing =
      !sourceName;

    const displaySourceName =
      sourceNameMissing
        ? `Unknown TV Time show (${sourceId})`
        : sourceName;

    const versionHint =
      getVersionHint(
        sourceName
      );

    const yearHint =
      getSourceYearHint(
        sourceName
      );

    /*
     * TV Time can assign different internal show IDs to
     * records that belong to the same logical show.
     * Resolve by normalized title plus explicit version/year.
     */
    const sourceKey =
      sourceNameMissing
        ? `orphan-id:${sourceId}`
        : `logical:${normalizeMatchTitle(
            sourceName
          )}:region:${versionHint}:year:${yearHint || ""}`;

    if (
      !sourceMap.has(
        sourceKey
      )
    ) {
      sourceMap.set(
        sourceKey,
        {
          sourceKey,
          sourceId,

          sourceName:
            displaySourceName,

          normalizedSourceName:
            sourceNameMissing
              ? ""
              : normalizeMatchTitle(
                  sourceName
                ),

          sourceNameMissing,

          reportedEpisodesSeen:
            reportedEpisodesSeenByShowId.get(
              sourceId
            ) || 0,

          episodeKeys:
            new Set(),

          episodePositions:
            new Map(),

          watchDates:
            [],

          followed:
            false,

          favorite:
            false,

          watchLater:
            false,
        }
      );
    }

    const source =
      sourceMap.get(
        sourceKey
      );

    if (
      source &&
      !source.sourceId &&
      sourceId
    ) {
      source.sourceId =
        sourceId;
    }

    return source;
  }

  for (
    const row of trackingRows
  ) {
    const source =
      ensureSource(
        row
      );

    if (!source) {
      continue;
    }

    const episodeKey =
      makeEpisodeKey(
        row
      );

    if (episodeKey) {
      source.episodeKeys.add(
        episodeKey
      );
    }

    const seasonNumber =
      seasonNumberFromRow(
        row
      );

    const episodeNumber =
      episodeNumberFromRow(
        row
      );

    if (
      Number.isInteger(
        seasonNumber
      ) &&
      seasonNumber >= 0 &&
      Number.isInteger(
        episodeNumber
      ) &&
      episodeNumber > 0
    ) {
      const positionKey =
        `${seasonNumber}:${episodeNumber}`;

      source.episodePositions.set(
        positionKey,
        {
          seasonNumber,
          episodeNumber,
        }
      );
    }

    const watchDate =
      parseDateValue(
        firstValue(
          row,
          [
            "created_at",
            "watch_date",
            "updated_at",
          ]
        )
      );

    if (watchDate) {
      source.watchDates.push(
        watchDate
      );
    }

    source.followed =
      source.followed ||
      toBoolean(
        row.is_followed
      );

    source.watchLater =
      source.watchLater ||
      toBoolean(
        row.is_for_later
      );
  }

  for (
    const row of followedRows
  ) {
    const source =
      ensureSource(
        row
      );

    if (!source) {
      continue;
    }

    source.followed =
      source.followed ||
      toBoolean(
        row.is_followed
      ) ||
      toBoolean(
        row.active
      );

    source.favorite =
      source.favorite ||
      toBoolean(
        row.is_favorited
      );
  }

  return Array.from(
    sourceMap.values()
  )
    .map(
      (source) => ({
        sourceKey:
          source.sourceKey,

        sourceId:
          source.sourceId,

        sourceName:
          source.sourceName,

        normalizedSourceName:
          source.normalizedSourceName,

        sourceNameMissing:
          source.sourceNameMissing === true,

        reportedEpisodesSeen:
          Number(
            source.reportedEpisodesSeen ||
            0
          ),

        recoveredEpisodeCount:
          source.episodeKeys.size,

        episodePattern:
          Array.from(
            source.episodePositions.values()
          )
            .reduce(
              (
                map,
                position
              ) => {
                if (
                  !map.has(
                    position.seasonNumber
                  )
                ) {
                  map.set(
                    position.seasonNumber,
                    []
                  );
                }

                map.get(
                  position.seasonNumber
                ).push(
                  position.episodeNumber
                );

                return map;
              },
              new Map()
            ),

        firstWatchDate:
          source.watchDates.length > 0
            ? new Date(
                Math.min(
                  ...source.watchDates.map(
                    (date) =>
                      date.getTime()
                  )
                )
              )
            : null,

        lastWatchDate:
          source.watchDates.length > 0
            ? new Date(
                Math.max(
                  ...source.watchDates.map(
                    (date) =>
                      date.getTime()
                  )
                )
              )
            : null,

        episodeCount:
          source.episodeKeys.size,

        followed:
          source.followed,

        favorite:
          source.favorite,

        watchLater:
          source.watchLater,
      })
    )
    .map(
      (source) => ({
        ...source,

        episodePattern:
          source.episodePattern instanceof Map
            ? Array.from(
                source.episodePattern.entries()
              )
                .map(
                  ([
                    seasonNumber,
                    episodes,
                  ]) => ({
                    seasonNumber:
                      Number(
                        seasonNumber
                      ),

                    episodes:
                      [
                        ...new Set(
                          episodes
                        ),
                      ].sort(
                        (
                          left,
                          right
                        ) =>
                          left -
                          right
                      ),
                  })
                )
                .sort(
                  (
                    left,
                    right
                  ) =>
                    left.seasonNumber -
                    right.seasonNumber
                )
            : [],
      })
    )
    .sort(
      (left, right) =>
        right.episodeCount -
          left.episodeCount ||
        left.sourceName.localeCompare(
          right.sourceName
        )
    );
}

async function resolveSourceShow(
  source
) {
  if (
    source.sourceNameMissing
  ) {
    return {
      ...source,

      status:
        "unmatched",

      selectedTmdbId:
        null,

      confidence:
        0,

      reason:
        "TV Time preserved the episode history but omitted the show name. Manual identification is required.",

      candidates:
        [],

      resolvedAt:
        new Date(),
    };
  }

  let searchData;

  const searchQuery =
    cleanTVTimeSearchTitle(
      source.sourceName
    );

  try {
    searchData =
      await searchTVShows(
        searchQuery ||
          source.sourceName,
        1,
        "en-US"
      );
  } catch (error) {
    return {
      ...source,

      status:
        "unmatched",

      selectedTmdbId:
        null,

      confidence:
        0,

      reason:
        `TMDB search failed: ${error.message}`,

      candidates:
        [],

      resolvedAt:
        new Date(),
    };
  }

  let rawCandidates =
    Array.isArray(
      searchData?.results
    )
      ? searchData.results
      : [];

  /*
   * TV Time often appends region labels such as "(US)".
   * Retry using the cleaned title when the original query
   * produced no useful candidates.
   */
  if (
    rawCandidates.length === 0
  ) {
    const cleanedTitle =
      String(
        source.sourceName
      )
        .replace(
          /\s*[\(\[]\s*(us|usa|uk|au|ca|fr|de|es|it|kr|jp)\s*[\)\]]\s*$/i,
          ""
        )
        .trim();

    if (
      cleanedTitle &&
      cleanedTitle !==
        source.sourceName
    ) {
      try {
        const retryData =
          await searchTVShows(
            cleanedTitle,
            1,
            "en-US"
          );

        rawCandidates =
          Array.isArray(
            retryData?.results
          )
            ? retryData.results
            : [];
      } catch {
        rawCandidates = [];
      }
    }
  }

  const candidates =
    rawCandidates
      .map(
        (candidate) => {
          const score =
            candidateScore(
              source.sourceName,
              candidate
            );

          return formatResolutionCandidate(
            candidate,
            score
          );
        }
      )
      .filter(
        (candidate) =>
          candidate.tmdbId
      )
      .sort(
        (left, right) =>
          right.score -
            left.score ||
          right.popularity -
            left.popularity
      )
      .slice(
        0,
        5
      );

  const best =
    candidates[0] ||
    null;

  const second =
    candidates[1] ||
    null;

  const margin =
    best
      ? best.score -
        (
          second?.score ||
          0
        )
      : 0;

  let status =
    "unmatched";

  let reason =
    "No reliable TMDB match was found.";

  const safeOverride =
    getSafeTitleOverride(
      source.sourceName
    );

  if (safeOverride) {
    const overrideCandidate =
      candidates.find(
        (candidate) =>
          Number(
            candidate.tmdbId
          ) ===
          Number(
            safeOverride.tmdbId
          )
      );

    if (overrideCandidate) {
      return {
        ...source,

        status:
          "matched",

        selectedTmdbId:
          overrideCandidate.tmdbId,

        confidence:
          1,

        reason:
          safeOverride.reason,

        candidates,

        resolvedAt:
          new Date(),
      };
    }
  }

  const sourceNormalized =
    normalizeMatchTitle(
      source.sourceName
    );

  const bestExact =
    best &&
    (
      normalizeMatchTitle(
        best.name
      ) ===
        sourceNormalized ||
      normalizeMatchTitle(
        best.originalName
      ) ===
        sourceNormalized
    );

  const secondExact =
    second &&
    (
      normalizeMatchTitle(
        second.name
      ) ===
        sourceNormalized ||
      normalizeMatchTitle(
        second.originalName
      ) ===
        sourceNormalized
    );

  const bestYear =
    best?.year ||
    null;

  const secondYear =
    second?.year ||
    null;

  const bestCountries =
    new Set(
      Array.isArray(
        best?.originCountry
      )
        ? best.originCountry
        : []
    );

  const secondCountries =
    new Set(
      Array.isArray(
        second?.originCountry
      )
        ? second.originCountry
        : []
    );

  const differentYears =
    Boolean(
      bestYear &&
      secondYear &&
      bestYear !== secondYear
    );

  const differentOrigins =
    bestCountries.size > 0 &&
    secondCountries.size > 0 &&
    !Array.from(
      bestCountries
    ).some(
      (country) =>
        secondCountries.has(
          country
        )
    );

  const genuinelyAmbiguous =
    bestExact &&
    secondExact &&
    margin < 0.008 &&
    (
      differentYears ||
      differentOrigins
    ) &&
    !getVersionHint(
      source.sourceName
    ) &&
    !getSourceYearHint(
      source.sourceName
    );

  if (
    best &&
    best.score >= 0.94 &&
    bestExact &&
    !genuinelyAmbiguous
  ) {
    status =
      "matched";

    reason =
      "Exact high-confidence title match.";
  } else if (
    best &&
    best.score >= 0.9 &&
    (
      margin >= 0.015 ||
      !second
    )
  ) {
    status =
      "matched";

    reason =
      "High-confidence title and version match.";
  } else if (
    best &&
    best.score >= 0.66
  ) {
    status =
      "uncertain";

    reason =
      "A likely match was found, but user confirmation is recommended.";
  }

  return {
    ...source,

    status,

    selectedTmdbId:
      status === "matched"
        ? best?.tmdbId ||
          null
        : null,

    confidence:
      best?.score ||
      0,

    reason,

    candidates,

    resolvedAt:
      new Date(),
  };
}

// ========================================================
// POST /api/tv-time-import/:jobId/resolve-shows
//
// Re-uploads the selected ZIP because archives are analyzed
// in memory and are not permanently stored.
// No Scene shows, episodes, or logs are created here.
// ========================================================

router.post(
  "/:jobId/resolve-shows",
  protect,
  upload.single("file"),
  async (
    req,
    res
  ) => {
    try {
      const job =
        await TVImportJob.findOne({
          _id:
            req.params.jobId,

          user:
            req.user._id,

          source:
            "tv_time",
        });

      if (!job) {
        return res
          .status(404)
          .json({
            error:
              "TV Time import job not found.",
          });
      }

      if (
        !req.file?.buffer
      ) {
        return res
          .status(400)
          .json({
            error:
              "Please upload the same TV Time ZIP file.",
          });
      }

      const uploadedHash =
        crypto
          .createHash(
            "sha256"
          )
          .update(
            req.file.buffer
          )
          .digest(
            "hex"
          );

      if (
        job.fileHash &&
        uploadedHash !==
          job.fileHash
      ) {
        return res
          .status(409)
          .json({
            error:
              "This ZIP file does not match the analyzed TV Time archive.",

            code:
              "TV_TIME_ARCHIVE_MISMATCH",
          });
      }

      job.status =
        "parsing";

      job.progressPercentage =
        10;

      job.currentStage =
        "Extracting TV Time shows";

      job.lastAttemptAt =
        new Date();

      job.attemptCount =
        Number(
          job.attemptCount ||
          0
        ) + 1;

      await job.save();

      const {
        csvFiles,
      } =
        readTVTimeArchive(
          req.file
        );

      const {
        parsedFiles,
        warnings:
          parseWarnings,
      } =
        parseAvailableFiles(
          csvFiles
        );

      const sourceShows =
        extractSourceShows(
          parsedFiles
        );

      if (
        sourceShows.length === 0
      ) {
        job.status =
          "failed";

        job.currentStage =
          "No shows found";

        job.errorCode =
          "NO_TV_TIME_SHOWS_FOUND";

        job.errorMessage =
          "No TV shows were detected in this archive.";

        job.failedStage =
          "show_resolution";

        await job.save();

        return res
          .status(400)
          .json({
            error:
              job.errorMessage,

            code:
              job.errorCode,
          });
      }

      const resolvedShows =
        [];

      const previousResolutionBySourceKey =
        new Map(
          (
            Array.isArray(
              job.showResolution
            )
              ? job.showResolution
              : []
          ).map(
            (show) => [
              String(
                show.sourceKey
              ),
              show,
            ]
          )
        );

      for (
        let index = 0;
        index <
        sourceShows.length;
        index += 1
      ) {
        const source =
          sourceShows[index];

        const previous =
          previousResolutionBySourceKey.get(
            String(
              source.sourceKey
            )
          );

        let resolved;

        /*
         * A successful or user-confirmed match is sticky.
         * Re-uploading the same ZIP must never regress because
         * a later TMDB search temporarily fails or is throttled.
         */
        if (
          previous &&
          [
            "matched",
            "confirmed",
          ].includes(
            previous.status
          ) &&
          Number(
            previous.selectedTmdbId
          ) > 0
        ) {
          resolved = {
            ...(
              typeof previous.toObject ===
              "function"
                ? previous.toObject()
                : previous
            ),

            /*
             * Refresh source evidence from the latest ZIP parse
             * while preserving the trusted TMDB decision.
             */
            ...source,

            status:
              previous.status,

            selectedTmdbId:
              Number(
                previous.selectedTmdbId
              ),

            confidence:
              Number(
                previous.confidence ||
                1
              ),

            reason:
              previous.reason ||
              "Preserved from a previous successful resolution.",

            candidates:
              Array.isArray(
                previous.candidates
              )
                ? previous.candidates
                : [],

            resolvedAt:
              previous.resolvedAt ||
              new Date(),

            confirmedAt:
              previous.confirmedAt ||
              null,
          };
        } else {
          resolved =
            await resolveSourceShow(
              source
            );
        }

        resolvedShows.push(
          resolved
        );

        job.progressPercentage =
          Math.min(
            95,
            15 +
              Math.round(
                (
                  (
                    index + 1
                  ) /
                  sourceShows.length
                ) *
                  80
              )
          );

        job.currentStage =
          `Resolving shows ${index + 1}/${sourceShows.length}`;

        /*
         * Save progress periodically without creating
         * excessive database writes.
         */
        if (
          (
            index + 1
          ) % 10 === 0
        ) {
          await job.save();
        }

        await sleep(
          120
        );
      }

      const matched =
        resolvedShows.filter(
          (show) =>
            show.status ===
            "matched"
        );

      const uncertain =
        resolvedShows.filter(
          (show) =>
            show.status ===
            "uncertain"
        );

      const unmatched =
        resolvedShows.filter(
          (show) =>
            show.status ===
            "unmatched"
        );

      job.showResolution =
        resolvedShows;

      job.status =
        "preview_ready";

      job.progressPercentage =
        100;

      job.currentStage =
        "Show resolution ready";

      job.resumeFromStage =
        "shows_resolved";

      job.stats.matchedShows =
        matched.length;

      job.stats.uncertainShows =
        uncertain.length;

      job.stats.unmatchedShows =
        unmatched.length;

      job.warnings = [
        ...(
          Array.isArray(
            job.warnings
          )
            ? job.warnings
            : []
        ),

        ...parseWarnings,

        ...(uncertain.length
          ? [
              {
                code:
                  "UNCERTAIN_SHOW_MATCHES",

                message:
                  "Some TV Time shows require confirmation before import.",

                count:
                  uncertain.length,
              },
            ]
          : []),

        ...(unmatched.length
          ? [
              {
                code:
                  "UNMATCHED_SHOWS",

                message:
                  "Some TV Time shows could not be matched to TMDB.",

                count:
                  unmatched.length,
              },
            ]
          : []),
      ];

      await job.save();

      return res
        .status(200)
        .json({
          readyForConfirmation:
            uncertain.length > 0 ||
            unmatched.length > 0,

          readyForEpisodeImport:
            uncertain.length === 0 &&
            unmatched.length === 0,

          job: {
            id:
              String(
                job._id
              ),

            status:
              job.status,

            progressPercentage:
              job.progressPercentage,

            currentStage:
              job.currentStage,
          },

          summary: {
            totalShows:
              resolvedShows.length,

            matched:
              matched.length,

            uncertain:
              uncertain.length,

            unmatched:
              unmatched.length,

            episodesUnderMatchedShows:
              matched.reduce(
                (
                  total,
                  show
                ) =>
                  total +
                  Number(
                    show.episodeCount ||
                    0
                  ),
                0
              ),
          },

          matched,

          uncertain,

          unmatched,
        });
    } catch (error) {
      console.error(
        "❌ TV Time show resolution failed:",
        error
      );

      try {
        await TVImportJob.findOneAndUpdate(
          {
            _id:
              req.params.jobId,

            user:
              req.user._id,
          },
          {
            $set: {
              status:
                "failed",

              progressPercentage:
                0,

              currentStage:
                "Show resolution failed",

              errorCode:
                error.code ||
                "SHOW_RESOLUTION_FAILED",

              errorMessage:
                cleanString(
                  error.message,
                  1000
                ),

              failedStage:
                "show_resolution",
            },
          }
        );
      } catch (
        updateError
      ) {
        console.error(
          "❌ Could not update failed resolution job:",
          updateError
        );
      }

      return res
        .status(500)
        .json({
          error:
            "Failed to resolve TV Time shows.",

          code:
            "SHOW_RESOLUTION_FAILED",
        });
    }
  }
);


// ========================================================
// MANUAL SHOW MATCH HELPERS
// ========================================================

function parsePositiveTmdbId(
  value
) {
  const parsed =
    Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 1
  ) {
    return null;
  }

  return parsed;
}

function serializeManualSearchResult(
  show
) {
  return {
    tmdbId:
      Number(
        show?.id
      ) || null,

    name:
      cleanString(
        show?.name,
        500
      ),

    originalName:
      cleanString(
        show?.original_name,
        500
      ),

    firstAirDate:
      cleanString(
        show?.first_air_date,
        50
      ),

    year:
      getYearFromDate(
        show?.first_air_date
      ),

    posterPath:
      show?.poster_path ||
      "",

    backdropPath:
      show?.backdrop_path ||
      "",

    originCountry:
      Array.isArray(
        show?.origin_country
      )
        ? show.origin_country
            .map(
              (country) =>
                cleanString(
                  country,
                  10
                )
            )
            .filter(Boolean)
        : [],

    popularity:
      Number(
        show?.popularity
      ) || 0,
  };
}

function candidateFromDetails(
  details
) {
  return {
    tmdbId:
      Number(
        details?.id
      ) || null,

    name:
      cleanString(
        details?.name,
        500
      ),

    originalName:
      cleanString(
        details?.original_name,
        500
      ),

    firstAirDate:
      cleanString(
        details?.first_air_date,
        50
      ),

    year:
      getYearFromDate(
        details?.first_air_date
      ),

    posterPath:
      details?.poster_path ||
      "",

    backdropPath:
      details?.backdrop_path ||
      "",

    originCountry:
      Array.isArray(
        details?.origin_country
      )
        ? details.origin_country
            .map(
              (country) =>
                cleanString(
                  country,
                  10
                )
            )
            .filter(Boolean)
        : [],

    popularity:
      Number(
        details?.popularity
      ) || 0,

    score:
      1,
  };
}

function recalculateShowResolutionStats(
  job
) {
  const resolutions =
    Array.isArray(
      job.showResolution
    )
      ? job.showResolution
      : [];

  const automatic =
    resolutions.filter(
      (show) =>
        show.status ===
        "matched"
    );

  const confirmed =
    resolutions.filter(
      (show) =>
        show.status ===
        "confirmed"
    );

  const uncertain =
    resolutions.filter(
      (show) =>
        show.status ===
        "uncertain"
    );

  const unmatched =
    resolutions.filter(
      (show) =>
        show.status ===
        "unmatched"
    );

  const rejected =
    resolutions.filter(
      (show) =>
        show.status ===
        "rejected"
    );

  job.stats.matchedShows =
    automatic.length +
    confirmed.length;

  job.stats.uncertainShows =
    uncertain.length;

  job.stats.unmatchedShows =
    unmatched.length;

  return {
    total:
      resolutions.length,

    automatic:
      automatic.length,

    confirmed:
      confirmed.length,

    matched:
      automatic.length +
      confirmed.length,

    uncertain:
      uncertain.length,

    unmatched:
      unmatched.length,

    skipped:
      rejected.length,

    unresolved:
      uncertain.length +
      unmatched.length,

    episodesReady:
      [...automatic, ...confirmed]
        .reduce(
          (
            total,
            show
          ) =>
            total +
            Number(
              show.episodeCount ||
              0
            ),
          0
        ),

    episodesSkipped:
      rejected.reduce(
        (
          total,
          show
        ) =>
          total +
          Number(
            show.episodeCount ||
            0
          ),
        0
      ),
  };
}

// ========================================================
// GET /api/tv-time-import/:jobId/show-search?q=...
//
// Used by the importer confirmation screen when a suggested
// match is incorrect or when a show was not found.
//
// Creates no local Show documents and no logs.
// ========================================================

router.get(
  "/:jobId/show-search",
  protect,
  async (
    req,
    res
  ) => {
    try {
      const job =
        await TVImportJob.findOne({
          _id:
            req.params.jobId,

          user:
            req.user._id,

          source:
            "tv_time",
        })
          .select(
            "_id status"
          )
          .lean();

      if (!job) {
        return res
          .status(404)
          .json({
            error:
              "TV Time import job not found.",
          });
      }

      const query =
        cleanString(
          req.query.q,
          150
        );

      if (
        query.length < 2
      ) {
        return res
          .status(400)
          .json({
            error:
              "Search query must contain at least 2 characters.",
          });
      }

      const data =
        await searchTVShows(
          query,
          1,
          "en-US"
        );

      const results =
        (
          Array.isArray(
            data?.results
          )
            ? data.results
            : []
        )
          .map(
            serializeManualSearchResult
          )
          .filter(
            (show) =>
              show.tmdbId &&
              show.name
          )
          .slice(
            0,
            20
          );

      return res
        .status(200)
        .json({
          query,
          results,
        });
    } catch (error) {
      console.error(
        "❌ TV Time manual show search failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Failed to search for TV shows.",
        });
    }
  }
);

// ========================================================
// PATCH /api/tv-time-import/:jobId/show-matches
//
// Body:
// {
//   matches: [
//     {
//       sourceKey: "...",
//       tmdbId: 123
//     }
//   ],
//   skippedSourceKeys: ["..."]
// }
//
// A selected TMDB ID may come from the suggested candidates
// or from the manual-search endpoint.
//
// Creates no episodes and no logs.
// ========================================================

router.patch(
  "/:jobId/show-matches",
  protect,
  async (
    req,
    res
  ) => {
    try {
      const job =
        await TVImportJob.findOne({
          _id:
            req.params.jobId,

          user:
            req.user._id,

          source:
            "tv_time",
        });

      if (!job) {
        return res
          .status(404)
          .json({
            error:
              "TV Time import job not found.",
          });
      }

      if (
        !Array.isArray(
          job.showResolution
        ) ||
        job.showResolution.length === 0
      ) {
        return res
          .status(409)
          .json({
            error:
              "Resolve the TV Time shows before confirming matches.",

            code:
              "SHOW_RESOLUTION_REQUIRED",
          });
      }

      const requestedMatches =
        Array.isArray(
          req.body?.matches
        )
          ? req.body.matches
          : [];

      const skippedSourceKeys =
        Array.isArray(
          req.body
            ?.skippedSourceKeys
        )
          ? req.body
              .skippedSourceKeys
              .map(
                (value) =>
                  cleanString(
                    value,
                    600
                  )
              )
              .filter(Boolean)
          : [];

      if (
        requestedMatches.length === 0 &&
        skippedSourceKeys.length === 0
      ) {
        return res
          .status(400)
          .json({
            error:
              "Provide at least one confirmed match or skipped show.",
          });
      }

      const resolutionMap =
        new Map(
          job.showResolution.map(
            (show) => [
              String(
                show.sourceKey
              ),
              show,
            ]
          )
        );

      const duplicateSourceKeys =
        new Set();

      const seenSourceKeys =
        new Set();

      for (
        const item of requestedMatches
      ) {
        const sourceKey =
          cleanString(
            item?.sourceKey,
            600
          );

        if (
          sourceKey &&
          seenSourceKeys.has(
            sourceKey
          )
        ) {
          duplicateSourceKeys.add(
            sourceKey
          );
        }

        if (sourceKey) {
          seenSourceKeys.add(
            sourceKey
          );
        }
      }

      if (
        duplicateSourceKeys.size > 0
      ) {
        return res
          .status(400)
          .json({
            error:
              "The same source show cannot be confirmed more than once.",

            duplicateSourceKeys:
              Array.from(
                duplicateSourceKeys
              ),
          });
      }

      const invalidMatches =
        [];

      const preparedMatches =
        [];

      for (
        const item of requestedMatches
      ) {
        const sourceKey =
          cleanString(
            item?.sourceKey,
            600
          );

        const tmdbId =
          parsePositiveTmdbId(
            item?.tmdbId
          );

        const resolution =
          resolutionMap.get(
            sourceKey
          );

        if (
          !sourceKey ||
          !tmdbId ||
          !resolution
        ) {
          invalidMatches.push({
            sourceKey:
              sourceKey ||
              null,

            tmdbId:
              tmdbId ||
              null,

            reason:
              !resolution
                ? "Unknown source show."
                : "Invalid TMDB show ID.",
          });

          continue;
        }

        let selectedCandidate =
          (
            Array.isArray(
              resolution.candidates
            )
              ? resolution.candidates
              : []
          ).find(
            (candidate) =>
              Number(
                candidate.tmdbId
              ) ===
              tmdbId
          ) ||
          null;

        /*
         * The user may choose a result from manual search
         * that was not in the original candidate list.
         * Validate that exact TMDB show before accepting it.
         */
        if (!selectedCandidate) {
          let details = null;

          try {
            details =
              await getTVShowDetails(
                tmdbId,
                "en-US"
              );
          } catch (
            detailsError
          ) {
            console.error(
              "⚠️ Manual TMDB show validation failed:",
              detailsError.message
            );
          }

          if (
            !details?.id ||
            !details?.name
          ) {
            invalidMatches.push({
              sourceKey,
              tmdbId,
              reason:
                "The selected TMDB show could not be validated.",
            });

            continue;
          }

          selectedCandidate =
            candidateFromDetails(
              details
            );
        }

        preparedMatches.push({
          resolution,
          selectedCandidate,
        });
      }

      if (
        invalidMatches.length > 0
      ) {
        return res
          .status(400)
          .json({
            error:
              "One or more show matches are invalid.",

            invalidMatches,
          });
      }

      const skippedSet =
        new Set(
          skippedSourceKeys
        );

      for (
        const sourceKey of skippedSet
      ) {
        if (
          !resolutionMap.has(
            sourceKey
          )
        ) {
          return res
            .status(400)
            .json({
              error:
                "One or more skipped shows are invalid.",

              invalidSourceKey:
                sourceKey,
            });
        }

        if (
          seenSourceKeys.has(
            sourceKey
          )
        ) {
          return res
            .status(400)
            .json({
              error:
                "A show cannot be confirmed and skipped in the same request.",

              sourceKey,
            });
        }
      }

      for (
        const {
          resolution,
          selectedCandidate,
        } of preparedMatches
      ) {
        const existingCandidates =
          Array.isArray(
            resolution.candidates
          )
            ? resolution.candidates
            : [];

        if (
          !existingCandidates.some(
            (candidate) =>
              Number(
                candidate.tmdbId
              ) ===
              Number(
                selectedCandidate.tmdbId
              )
          )
        ) {
          resolution.candidates = [
            selectedCandidate,
            ...existingCandidates,
          ].slice(
            0,
            10
          );
        }

        resolution.status =
          "confirmed";

        resolution.selectedTmdbId =
          Number(
            selectedCandidate.tmdbId
          );

        resolution.confidence =
          1;

        resolution.reason =
          "Confirmed by the user during the TV Time accuracy check.";

        resolution.confirmedAt =
          new Date();
      }

      for (
        const sourceKey of skippedSet
      ) {
        const resolution =
          resolutionMap.get(
            sourceKey
          );

        resolution.status =
          "rejected";

        resolution.selectedTmdbId =
          null;

        resolution.confidence =
          0;

        resolution.reason =
          "Skipped by the user during the TV Time accuracy check.";

        resolution.confirmedAt =
          new Date();
      }

      const summary =
        recalculateShowResolutionStats(
          job
        );

      const readyForEpisodeResolution =
        summary.unresolved === 0;

      job.status =
        "preview_ready";

      job.progressPercentage =
        readyForEpisodeResolution
          ? 100
          : 95;

      job.currentStage =
        readyForEpisodeResolution
          ? "Show matches confirmed"
          : "Waiting for show confirmations";

      job.resumeFromStage =
        readyForEpisodeResolution
          ? "show_matches_confirmed"
          : "shows_resolved";

      job.errorCode =
        "";

      job.errorMessage =
        "";

      job.failedStage =
        "";

      await job.save();

      const unresolved =
        job.showResolution.filter(
          (show) =>
            show.status ===
              "uncertain" ||
            show.status ===
              "unmatched"
        );

      const skipped =
        job.showResolution.filter(
          (show) =>
            show.status ===
            "rejected"
        );

      return res
        .status(200)
        .json({
          message:
            readyForEpisodeResolution
              ? "Show matches confirmed. Episode resolution is ready."
              : "Show matches saved. More confirmations are required.",

          readyForEpisodeResolution,

          job: {
            id:
              String(
                job._id
              ),

            status:
              job.status,

            currentStage:
              job.currentStage,

            progressPercentage:
              job.progressPercentage,
          },

          summary,

          unresolved,

          skipped,
        });
    } catch (error) {
      console.error(
        "❌ TV Time show-match confirmation failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Failed to save TV Time show matches.",

          code:
            "SHOW_MATCH_CONFIRMATION_FAILED",
        });
    }
  }
);


// ========================================================
// EPISODE RESOLUTION HELPERS
// ========================================================

/*
 * Explicit compatibility mappings are used only when:
 *
 * 1. the direct SxE position does not exist in TMDB;
 * 2. the source episode ID no longer resolves through TMDB /find;
 * 3. the equivalent TMDB episode has been independently verified.
 *
 * Never add broad show-level offsets here.
 */
const TV_TIME_EPISODE_COMPATIBILITY_OVERRIDES =
  new Map([
    [
      "303917",
      {
        showTmdbId: 1668,
        seasonNumber: 4,
        episodeNumber: 23,
        reason:
          "TV Time split the combined Friends season 4 finale.",
      },
    ],

    [
      "303941",
      {
        showTmdbId: 1668,
        seasonNumber: 5,
        episodeNumber: 23,
        reason:
          "TV Time split the combined Friends season 5 finale.",
      },
    ],

    [
      "303966",
      {
        showTmdbId: 1668,
        seasonNumber: 6,
        episodeNumber: 23,
        reason:
          "TV Time split the combined Friends season 6 finale.",
      },
    ],

    [
      "303990",
      {
        showTmdbId: 1668,
        seasonNumber: 7,
        episodeNumber: 23,
        reason:
          "TV Time split the combined Friends season 7 finale.",
      },
    ],

    [
      "304015",
      {
        showTmdbId: 1668,
        seasonNumber: 8,
        episodeNumber: 23,
        reason:
          "TV Time split the combined Friends season 8 finale.",
      },
    ],

    [
      "304039",
      {
        showTmdbId: 1668,
        seasonNumber: 9,
        episodeNumber: 23,
        reason:
          "TV Time split the combined Friends season 9 finale.",
      },
    ],

    [
      "852901",
      {
        showTmdbId: 1668,
        seasonNumber: 10,
        episodeNumber: 17,
        reason:
          "TV Time split the combined Friends series finale.",
      },
    ],
  ]);

function serializeResolvedEpisode({
  item,
  episode,
  resolutionMethod,
  externalSource = "",
  compatibilityReason = "",
}) {
  return {
    sourceEpisodeId:
      episodeIdFromRow(
        item.row
      ),

    sourceKey:
      item.sourceKey,

    sourceName:
      item.resolution
        ?.sourceName ||
      showNameFromRow(
        item.row
      ) ||
      "",

    showTmdbId:
      Number(
        episode.showTmdbId ||
        item.showTmdbId
      ),

    episodeTmdbId:
      Number(
        episode.tmdbId
      ),

    seasonNumber:
      Number(
        episode.seasonNumber
      ),

    episodeNumber:
      Number(
        episode.episodeNumber
      ),

    sourceSeasonNumber:
      seasonNumberFromRow(
        item.row
      ),

    sourceEpisodeNumber:
      episodeNumberFromRow(
        item.row
      ),

    episodeName:
      episode.name ||
      "",

    airDate:
      episode.airDate ||
      null,

    runtime:
      Number(
        episode.runtime
      ) || null,

    stillPath:
      episode.stillPath ||
      "",

    watchDate:
      parseDateValue(
        firstValue(
          item.row,
          [
            "created_at",
            "watch_date",
            "updated_at",
          ]
        )
      ),

    isSpecial:
      Number(
        episode.seasonNumber
      ) === 0,

    resolutionMethod,

    externalSource,

    compatibilityReason,
  };
}

function serializeManualEpisodeCard({
  item,
  status,
  reason,
  externalLookupAttempted = false,
}) {
  return {
    type:
      "episode",

    status,

    sourceKey:
      item.sourceKey,

    sourceEpisodeId:
      episodeIdFromRow(
        item.row
      ),

    sourceName:
      item.resolution
        ?.sourceName ||
      showNameFromRow(
        item.row
      ) ||
      "",

    showTmdbId:
      Number(
        item.showTmdbId
      ) || null,

    sourceSeasonNumber:
      seasonNumberFromRow(
        item.row
      ),

    sourceEpisodeNumber:
      episodeNumberFromRow(
        item.row
      ),

    watchDate:
      parseDateValue(
        firstValue(
          item.row,
          [
            "created_at",
            "watch_date",
            "updated_at",
          ]
        )
      ),

    isUnitary:
      normalizeBoolean(
        firstValue(
          item.row,
          [
            "is_unitary",
          ]
        )
      ),

    externalLookupAttempted,

    reason,
  };
}

async function resolveCachedEpisodeDocument({
  showTmdbId,
  seasonNumber,
  episodeNumber,
}) {
  let episode =
    await Episode.findOne({
      showTmdbId:
        Number(
          showTmdbId
        ),

      seasonNumber:
        Number(
          seasonNumber
        ),

      episodeNumber:
        Number(
          episodeNumber
        ),
    }).lean();

  if (episode) {
    return episode;
  }

  try {
    await syncEpisodeFromTMDB(
      Number(
        showTmdbId
      ),
      Number(
        seasonNumber
      ),
      Number(
        episodeNumber
      ),
      {
        force:
          false,

        maxAgeMinutes:
          10080,
      }
    );
  } catch (error) {
    console.error(
      "⚠️ Could not sync fallback episode:",
      {
        showTmdbId,
        seasonNumber,
        episodeNumber,
        error:
          error.message,
      }
    );
  }

  episode =
    await Episode.findOne({
      showTmdbId:
        Number(
          showTmdbId
        ),

      seasonNumber:
        Number(
          seasonNumber
        ),

      episodeNumber:
        Number(
          episodeNumber
        ),
    }).lean();

  return episode ||
    null;
}

async function resolveEpisodeByExternalId({
  item,
}) {
  const sourceEpisodeId =
    episodeIdFromRow(
      item.row
    );

  if (!sourceEpisodeId) {
    return null;
  }

  let candidates = [];

  try {
    candidates =
      await findTVEpisodesByExternalId(
        sourceEpisodeId,
        {
          externalSource:
            "tvdb_id",

          language:
            "en-US",
        }
      );
  } catch (error) {
    console.error(
      "⚠️ TV Time external episode lookup failed:",
      {
        sourceEpisodeId,
        sourceName:
          item.resolution
            ?.sourceName,

        error:
          error.message,
      }
    );

    return null;
  }

  const sameShow =
    candidates.filter(
      (candidate) =>
        Number(
          candidate?.show_id
        ) ===
        Number(
          item.showTmdbId
        )
    );

  const eligible =
    sameShow.length > 0
      ? sameShow
      : candidates;

  if (
    eligible.length !== 1
  ) {
    return null;
  }

  const candidate =
    eligible[0];

  const candidateShowTmdbId =
    Number(
      candidate.show_id
    );

  const candidateSeasonNumber =
    Number(
      candidate.season_number
    );

  const candidateEpisodeNumber =
    Number(
      candidate.episode_number
    );

  if (
    candidateShowTmdbId !==
      Number(
        item.showTmdbId
      ) ||
    !Number.isInteger(
      candidateSeasonNumber
    ) ||
    candidateSeasonNumber < 0 ||
    !Number.isInteger(
      candidateEpisodeNumber
    ) ||
    candidateEpisodeNumber < 1
  ) {
    return null;
  }

  const episode =
    await resolveCachedEpisodeDocument({
      showTmdbId:
        candidateShowTmdbId,

      seasonNumber:
        candidateSeasonNumber,

      episodeNumber:
        candidateEpisodeNumber,
    });

  if (!episode) {
    return null;
  }

  return {
    episode,

    resolutionMethod:
      "external_id",

    externalSource:
      "tvdb_id",
  };
}

async function resolveEpisodeByCompatibilityOverride({
  item,
}) {
  const sourceEpisodeId =
    episodeIdFromRow(
      item.row
    );

  const override =
    TV_TIME_EPISODE_COMPATIBILITY_OVERRIDES.get(
      String(
        sourceEpisodeId ||
        ""
      )
    );

  if (!override) {
    return null;
  }

  if (
    Number(
      override.showTmdbId
    ) !==
    Number(
      item.showTmdbId
    )
  ) {
    return null;
  }

  const episode =
    await resolveCachedEpisodeDocument({
      showTmdbId:
        override.showTmdbId,

      seasonNumber:
        override.seasonNumber,

      episodeNumber:
        override.episodeNumber,
    });

  if (!episode) {
    return null;
  }

  return {
    episode,

    resolutionMethod:
      "compatibility_override",

    compatibilityReason:
      override.reason,
  };
}


function sourceKeyForTrackingRow(
  row
) {
  const sourceName =
    showNameFromRow(
      row
    );

  const sourceId =
    showIdFromRow(
      row
    );

  if (
    !sourceName &&
    sourceId
  ) {
    return `orphan-id:${sourceId}`;
  }

  if (!sourceName) {
    return "";
  }

  return (
    `logical:${normalizeMatchTitle(
      sourceName
    )}:region:${getVersionHint(
      sourceName
    )}:year:${getSourceYearHint(
      sourceName
    ) || ""}`
  );
}

function serializeEpisodeIssue(
  {
    row,
    sourceKey,
    sourceName,
    showTmdbId = null,
    status,
    reason,
  }
) {
  return {
    sourceEpisodeId:
      episodeIdFromRow(
        row
      ),

    sourceKey,

    sourceName:
      sourceName ||
      showNameFromRow(
        row
      ) ||
      "",

    showTmdbId:
      Number(
        showTmdbId
      ) || null,

    seasonNumber:
      seasonNumberFromRow(
        row
      ),

    episodeNumber:
      episodeNumberFromRow(
        row
      ),

    status,

    reason,
  };
}



function extractTVTimeVoteOptionId(
  voteKey
) {
  const normalized =
    cleanString(
      voteKey,
      1000
    );

  if (!normalized) {
    return "";
  }

  const parts =
    normalized.split("-");

  return cleanString(
    parts[
      parts.length - 1
    ],
    100
  );
}

function buildTVTimeRatingVoteMap(
  parsedFiles
) {
  /*
   * Priority is newest/most episode-specific generation first.
   * Duplicate generations describe the same source vote.
   */
  const rows =
    rowsWithSourceFiles(
      parsedFiles,
      [
        "ratings-3-prod-episode_votes.csv",
        "ratings-v2-prod-votes.csv",
        "ratings-prod-episode_votes.csv",
        "ratings-live-votes.csv",
      ]
    );

  const byEpisodeId =
    new Map();

  for (
    const entry of rows
  ) {
    const row =
      entry.row ||
      {};

    const sourceEpisodeId =
      cleanString(
        row.episode_id,
        200
      );

    const seriesName =
      cleanString(
        row.series_name,
        500
      );

    const voteKey =
      cleanString(
        row.vote_key,
        1000
      );

    /*
     * Historical rating files contain movie votes too.
     * A TV episode vote must identify an episode and series.
     */
    if (
      !sourceEpisodeId ||
      sourceEpisodeId ===
        "0" ||
      !seriesName ||
      !voteKey
    ) {
      continue;
    }

    /*
     * First record wins because fileNames are ordered from
     * the preferred generation to older duplicate sources.
     */
    if (
      byEpisodeId.has(
        sourceEpisodeId
      )
    ) {
      continue;
    }

    byEpisodeId.set(
      sourceEpisodeId,
      {
        sourceEpisodeId,

        voteKey,

        optionId:
          extractTVTimeVoteOptionId(
            voteKey
          ),

        seriesName,

        sourceSeasonNumber:
          Number(
            row.season_number
          ) || null,

        sourceEpisodeNumber:
          Number(
            row.episode_number
          ) || null,

        sourceFile:
          entry.sourceFile,

        /*
         * TV Time does not provide a documented numeric
         * star-score mapping for this opaque vote identifier.
         */
        sceneRating:
          null,

        safelyConverted:
          false,
      }
    );
  }

  return byEpisodeId;
}

function buildTVTimeCharacterVoteMap(
  parsedFiles
) {
  const rows =
    rowsWithSourceFiles(
      parsedFiles,
      [
        "show_character_episode_vote.csv",
      ]
    );

  const byEpisodeId =
    new Map();

  for (
    const entry of rows
  ) {
    const row =
      entry.row ||
      {};

    const sourceEpisodeId =
      cleanString(
        row.episode_id,
        200
      );

    const externalCharacterId =
      cleanString(
        row.show_character_id,
        200
      );

    if (
      !sourceEpisodeId ||
      sourceEpisodeId ===
        "0" ||
      !externalCharacterId
    ) {
      continue;
    }

    /*
     * The export normally has one character vote per episode.
     * Preserve the first stable record if duplicates appear.
     */
    if (
      byEpisodeId.has(
        sourceEpisodeId
      )
    ) {
      continue;
    }

    byEpisodeId.set(
      sourceEpisodeId,
      {
        sourceEpisodeId,

        externalCharacterId,

        seriesName:
          cleanString(
            row.tv_show_name,
            500
          ),

        sourceSeasonNumber:
          Number(
            row.episode_season_number
          ) || null,

        sourceEpisodeNumber:
          Number(
            row.episode_number
          ) || null,

        createdAt:
          parseDateValue(
            row.created_at
          ),

        updatedAt:
          parseDateValue(
            row.updated_at
          ),

        sourceFile:
          entry.sourceFile,

        /*
         * The source export does not include a character name,
         * actor identity, or TMDB person ID.
         */
        resolvedCharacter:
          null,

        safelyResolved:
          false,
      }
    );
  }

  return byEpisodeId;
}

function attachTVTimeEpisodeMetadata({
  rows,
  ratingVoteMap,
  characterVoteMap,
}) {
  /*
   * Votes are episode-level rather than individual-watch-level.
   * Attach them to the latest chronological watch for that
   * source episode, preserving rewatches without duplication.
   */
  const latestRowBySourceEpisodeId =
    new Map();

  for (
    const row of rows
  ) {
    const key =
      cleanString(
        row.sourceEpisodeId,
        200
      );

    if (!key) {
      continue;
    }

    const existing =
      latestRowBySourceEpisodeId.get(
        key
      );

    if (
      !existing ||
      row.watchDate.getTime() >
        existing.watchDate.getTime() ||
      (
        row.watchDate.getTime() ===
          existing.watchDate.getTime() &&
        String(
          row.externalImportId
        ) >
          String(
            existing.externalImportId
          )
      )
    ) {
      latestRowBySourceEpisodeId.set(
        key,
        row
      );
    }
  }

  let ratingsPreserved =
    0;

  let characterVotesPreserved =
    0;

  for (
    const [
      sourceEpisodeId,
      row,
    ] of latestRowBySourceEpisodeId
  ) {
    const ratingVote =
      ratingVoteMap.get(
        sourceEpisodeId
      );

    if (ratingVote) {
      row.sourceRatingVote = {
        ...ratingVote,

        createdAt:
          ratingVote.createdAt
            ? ratingVote.createdAt
                .toISOString()
            : null,

        updatedAt:
          ratingVote.updatedAt
            ? ratingVote.updatedAt
                .toISOString()
            : null,
      };

      ratingsPreserved +=
        1;
    }

    const characterVote =
      characterVoteMap.get(
        sourceEpisodeId
      );

    if (characterVote) {
      row.sourceFavoriteCharacterVote = {
        ...characterVote,

        createdAt:
          characterVote.createdAt
            ? characterVote.createdAt
                .toISOString()
            : null,

        updatedAt:
          characterVote.updatedAt
            ? characterVote.updatedAt
                .toISOString()
            : null,
      };

      characterVotesPreserved +=
        1;
    }
  }

  return {
    ratingsPreserved,
    characterVotesPreserved,
  };
}

function stableJSONStringify(
  value
) {
  if (
    value === null ||
    typeof value !== "object"
  ) {
    return JSON.stringify(
      value
    );
  }

  if (
    Array.isArray(
      value
    )
  ) {
    return (
      "[" +
      value
        .map(
          stableJSONStringify
        )
        .join(",") +
      "]"
    );
  }

  const keys =
    Object.keys(
      value
    ).sort();

  return (
    "{" +
    keys
      .map(
        (key) =>
          JSON.stringify(
            key
          ) +
          ":" +
          stableJSONStringify(
            value[key]
          )
      )
      .join(",") +
    "}"
  );
}

function buildTVTimeExternalImportId({
  fileHash,
  sourceEpisodeId,
  watchDate,
  sourceSeasonNumber,
  sourceEpisodeNumber,
}) {
  const normalizedDate =
    watchDate instanceof Date &&
    !Number.isNaN(
      watchDate.getTime()
    )
      ? watchDate.toISOString()
      : "";

  const identity = [
    "tv_time",
    cleanString(
      fileHash,
      200
    ),
    cleanString(
      sourceEpisodeId,
      200
    ),
    normalizedDate,
    Number(
      sourceSeasonNumber
    ) || 0,
    Number(
      sourceEpisodeNumber
    ) || 0,
  ].join(":");

  return crypto
    .createHash(
      "sha256"
    )
    .update(
      identity
    )
    .digest(
      "hex"
    );
}

function normalizeResolvedPlanRow(
  row
) {
  const watchDate =
    parseDateValue(
      row?.watchDate
    );

  const showTmdbId =
    Number(
      row?.showTmdbId
    );

  const episodeTmdbId =
    Number(
      row?.episodeTmdbId
    );

  const seasonNumber =
    Number(
      row?.seasonNumber
    );

  const episodeNumber =
    Number(
      row?.episodeNumber
    );

  const sourceSeasonNumber =
    Number(
      row?.sourceSeasonNumber
    );

  const sourceEpisodeNumber =
    Number(
      row?.sourceEpisodeNumber
    );

  if (
    !cleanString(
      row?.sourceEpisodeId,
      200
    ) ||
    !Number.isInteger(
      showTmdbId
    ) ||
    showTmdbId < 1 ||
    !Number.isInteger(
      episodeTmdbId
    ) ||
    episodeTmdbId < 1 ||
    !Number.isInteger(
      seasonNumber
    ) ||
    seasonNumber < 0 ||
    !Number.isInteger(
      episodeNumber
    ) ||
    episodeNumber < 1 ||
    !watchDate
  ) {
    return null;
  }

  return {
    sourceEpisodeId:
      cleanString(
        row.sourceEpisodeId,
        200
      ),

    sourceKey:
      cleanString(
        row.sourceKey,
        500
      ),

    sourceName:
      cleanString(
        row.sourceName,
        500
      ),

    showTmdbId,
    episodeTmdbId,
    seasonNumber,
    episodeNumber,

    sourceSeasonNumber:
      Number.isInteger(
        sourceSeasonNumber
      )
        ? sourceSeasonNumber
        : seasonNumber,

    sourceEpisodeNumber:
      Number.isInteger(
        sourceEpisodeNumber
      )
        ? sourceEpisodeNumber
        : episodeNumber,

    episodeName:
      cleanString(
        row.episodeName,
        1000
      ),

    airDate:
      row.airDate ||
      null,

    runtime:
      Number(
        row.runtime
      ) || null,

    stillPath:
      cleanString(
        row.stillPath,
        1000
      ),

    watchDate,

    isSpecial:
      row.isSpecial === true ||
      seasonNumber === 0,

    resolutionMethod:
      cleanString(
        row.resolutionMethod,
        100
      ) ||
      "direct_sxe",
  };
}

function assignImportWatchNumbers(
  rows
) {
  const sorted =
    [...rows].sort(
      (
        left,
        right
      ) => {
        const dateDifference =
          left.watchDate.getTime() -
          right.watchDate.getTime();

        if (
          dateDifference !== 0
        ) {
          return dateDifference;
        }

        return String(
          left.externalImportId
        ).localeCompare(
          String(
            right.externalImportId
          )
        );
      }
    );

  const counts =
    new Map();

  for (
    const row of sorted
  ) {
    const episodeIdentity =
      `${row.showTmdbId}:${row.seasonNumber}:${row.episodeNumber}`;

    const next =
      Number(
        counts.get(
          episodeIdentity
        ) ||
        0
      ) + 1;

    counts.set(
      episodeIdentity,
      next
    );

    row.watchNumber =
      next;

    row.rewatch =
      next > 1;
  }

  return sorted;
}


function normalizeExecutionPlanRow(
  row
) {
  const watchedAt =
    parseDateValue(
      row?.watchDate
    );

  const showTmdbId =
    Number(
      row?.showTmdbId
    );

  const episodeTmdbId =
    Number(
      row?.episodeTmdbId
    );

  const seasonNumber =
    Number(
      row?.seasonNumber
    );

  const episodeNumber =
    Number(
      row?.episodeNumber
    );

  const watchNumber =
    Number(
      row?.watchNumber
    );

  const externalImportId =
    cleanString(
      row?.externalImportId,
      500
    );

  const sourceEpisodeId =
    cleanString(
      row?.sourceEpisodeId,
      200
    );

  if (
    !externalImportId ||
    !sourceEpisodeId ||
    !watchedAt ||
    !Number.isInteger(
      showTmdbId
    ) ||
    showTmdbId < 1 ||
    !Number.isInteger(
      episodeTmdbId
    ) ||
    episodeTmdbId < 1 ||
    !Number.isInteger(
      seasonNumber
    ) ||
    seasonNumber < 0 ||
    !Number.isInteger(
      episodeNumber
    ) ||
    episodeNumber < 1 ||
    !Number.isInteger(
      watchNumber
    ) ||
    watchNumber < 1
  ) {
    return null;
  }

  return {
    externalImportId,
    sourceEpisodeId,
    showTmdbId,
    episodeTmdbId,
    seasonNumber,
    episodeNumber,
    watchNumber,

    rewatch:
      watchNumber > 1,

    watchedAt,

    sourceKey:
      cleanString(
        row?.sourceKey,
        500
      ),

    sourceName:
      cleanString(
        row?.sourceName,
        500
      ),

    sourceSeasonNumber:
      Number(
        row?.sourceSeasonNumber
      ),

    sourceEpisodeNumber:
      Number(
        row?.sourceEpisodeNumber
      ),

    resolutionMethod:
      cleanString(
        row?.resolutionMethod,
        100
      ),

    sourceRatingVote:
      row?.sourceRatingVote &&
      typeof row.sourceRatingVote ===
        "object"
        ? row.sourceRatingVote
        : null,

    sourceFavoriteCharacterVote:
      row?.sourceFavoriteCharacterVote &&
      typeof row
        .sourceFavoriteCharacterVote ===
        "object"
        ? row.sourceFavoriteCharacterVote
        : null,
  };
}

function buildExecutionPlanIdentity({
  job,
  rows,
}) {
  return {
    jobId:
      String(
        job._id
      ),

    fileHash:
      cleanString(
        job.fileHash,
        500
      ),

    rows:
      rows.map(
        (row) => ({
          externalImportId:
            row.externalImportId,

          watchNumber:
            row.watchNumber,

          rewatch:
            row.rewatch,

          sourceRatingVote:
            row.sourceRatingVote ||
            null,

          sourceFavoriteCharacterVote:
            row.sourceFavoriteCharacterVote ||
            null,
        })
      ),
  };
}

function calculateExecutionPlanHash({
  job,
  rows,
}) {
  return crypto
    .createHash(
      "sha256"
    )
    .update(
      stableJSONStringify(
        buildExecutionPlanIdentity({
          job,
          rows,
        })
      )
    )
    .digest(
      "hex"
    );
}

function chunkArray(
  values,
  size
) {
  const chunks =
    [];

  for (
    let index = 0;
    index < values.length;
    index += size
  ) {
    chunks.push(
      values.slice(
        index,
        index + size
      )
    );
  }

  return chunks;
}

function uniqueWarningList(
  warnings
) {
  const map =
    new Map();

  for (
    const warning of warnings
  ) {
    const key =
      `${warning.code}:${warning.message}`;

    const existing =
      map.get(
        key
      );

    if (existing) {
      existing.count +=
        Number(
          warning.count ||
          1
        );
    } else {
      map.set(
        key,
        {
          ...warning,

          count:
            Number(
              warning.count ||
              1
            ),
        }
      );
    }
  }

  return Array.from(
    map.values()
  );
}

// ========================================================
// POST /api/tv-time-import/:jobId/resolve-episodes
//
// Re-uploads the original ZIP, validates its hash, resolves
// every watched SxE position against the confirmed TMDB
// shows, and creates a preview.
//
// Season and Episode metadata may be cached from TMDB.
// No TVLog documents are created.
// ========================================================

router.post(
  "/:jobId/resolve-episodes",
  protect,
  upload.single("file"),
  async (
    req,
    res
  ) => {
    try {
      const job =
        await TVImportJob.findOne({
          _id:
            req.params.jobId,

          user:
            req.user._id,

          source:
            "tv_time",
        });

      if (!job) {
        return res
          .status(404)
          .json({
            error:
              "TV Time import job not found.",
          });
      }

      if (
        !req.file?.buffer
      ) {
        return res
          .status(400)
          .json({
            error:
              "Please upload the same TV Time ZIP file.",
          });
      }

      const uploadedHash =
        crypto
          .createHash(
            "sha256"
          )
          .update(
            req.file.buffer
          )
          .digest(
            "hex"
          );

      if (
        job.fileHash &&
        uploadedHash !==
          job.fileHash
      ) {
        return res
          .status(409)
          .json({
            error:
              "This ZIP file does not match the analyzed TV Time archive.",

            code:
              "TV_TIME_ARCHIVE_MISMATCH",
          });
      }

      if (
        !Array.isArray(
          job.showResolution
        ) ||
        job.showResolution.length === 0
      ) {
        return res
          .status(409)
          .json({
            error:
              "Show resolution must be completed first.",

            code:
              "SHOW_RESOLUTION_REQUIRED",
          });
      }

      job.status =
        "parsing";

      job.progressPercentage =
        5;

      job.currentStage =
        "Preparing episode resolution";

      job.lastAttemptAt =
        new Date();

      job.attemptCount =
        Number(
          job.attemptCount ||
          0
        ) + 1;

      await job.save();

      const {
        csvFiles,
      } =
        readTVTimeArchive(
          req.file
        );

      const {
        parsedFiles,
        warnings:
          parseWarnings,
      } =
        parseAvailableFiles(
          csvFiles
        );

      const trackingRows =
        rowsFromFiles(
          parsedFiles,
          [
            "tracking-prod-records-v2.csv",
          ]
        );

      const showResolutionMap =
        new Map(
          job.showResolution.map(
            (show) => [
              String(
                show.sourceKey
              ),
              show,
            ]
          )
        );

      const uniqueRows =
        new Map();

      let duplicateSourceRows =
        0;

      for (
        const row of trackingRows
      ) {
        const episodeKey =
          makeEpisodeKey(
            row
          );

        if (!episodeKey) {
          continue;
        }

        if (
          uniqueRows.has(
            episodeKey
          )
        ) {
          duplicateSourceRows += 1;
          continue;
        }

        uniqueRows.set(
          episodeKey,
          row
        );
      }

      const rows =
        Array.from(
          uniqueRows.values()
        );

      const blockedIssues =
        [];

      const invalidIssues =
        [];

      const missingIssues =
        [];

      const specialIssues =
        [];

      const fallbackCandidates =
        [];

      const manualEpisodeCards =
        [];

      const resolvableRows =
        [];

      const requiredSeasons =
        new Map();

      let preservedWatchDates =
        0;

      for (
        const row of rows
      ) {
        const sourceKey =
          sourceKeyForTrackingRow(
            row
          );

        const resolution =
          showResolutionMap.get(
            sourceKey
          );

        const seasonNumber =
          seasonNumberFromRow(
            row
          );

        const episodeNumber =
          episodeNumberFromRow(
            row
          );

        const watchDate =
          parseDateValue(
            firstValue(
              row,
              [
                "created_at",
                "watch_date",
                "updated_at",
              ]
            )
          );

        if (watchDate) {
          preservedWatchDates += 1;
        }

        if (
          !resolution ||
          ![
            "matched",
            "confirmed",
          ].includes(
            resolution.status
          ) ||
          !Number(
            resolution.selectedTmdbId
          )
        ) {
          blockedIssues.push(
            serializeEpisodeIssue({
              row,
              sourceKey,
              sourceName:
                resolution?.sourceName ||
                showNameFromRow(
                  row
                ),

              status:
                "blocked_show",

              reason:
                resolution
                  ? "The source show still requires confirmation."
                  : "No saved show resolution was found.",
            })
          );

          continue;
        }

        if (
          !Number.isInteger(
            seasonNumber
          ) ||
          seasonNumber < 0 ||
          !Number.isInteger(
            episodeNumber
          ) ||
          episodeNumber < 1
        ) {
          fallbackCandidates.push({
            row,
            sourceKey,
            resolution,
            showTmdbId:
              Number(
                resolution.selectedTmdbId
              ),

            seasonNumber,
            episodeNumber,
            originalFailure:
              "invalid_position",

            originalReason:
              "TV Time did not provide a valid season and episode position.",
          });

          continue;
        }

        const showTmdbId =
          Number(
            resolution.selectedTmdbId
          );

        const seasonKey =
          `${showTmdbId}:${seasonNumber}`;

        if (
          !requiredSeasons.has(
            seasonKey
          )
        ) {
          requiredSeasons.set(
            seasonKey,
            {
              showTmdbId,
              seasonNumber,
              rows:
                [],
            }
          );
        }

        requiredSeasons.get(
          seasonKey
        ).rows.push(
          row
        );

        resolvableRows.push({
          row,
          sourceKey,
          resolution,
          showTmdbId,
          seasonNumber,
          episodeNumber,
          seasonKey,
        });
      }

      const seasonEntries =
        Array.from(
          requiredSeasons.values()
        );

      const syncedSeasonKeys =
        new Set();

      /*
       * Cache-first:
       * only sync a season when one or more required episode
       * positions are missing locally.
       */
      for (
        let index = 0;
        index <
        seasonEntries.length;
        index += 1
      ) {
        const seasonEntry =
          seasonEntries[index];

        const requestedNumbers =
          [
            ...new Set(
              seasonEntry.rows.map(
                (row) =>
                  episodeNumberFromRow(
                    row
                  )
              )
            ),
          ].filter(
            (number) =>
              Number.isInteger(
                number
              ) &&
              number > 0
          );

        const cachedCount =
          await Episode.countDocuments({
            showTmdbId:
              seasonEntry.showTmdbId,

            seasonNumber:
              seasonEntry.seasonNumber,

            episodeNumber: {
              $in:
                requestedNumbers,
            },
          });

        if (
          cachedCount <
          requestedNumbers.length
        ) {
          try {
            await syncSeasonFromTMDB(
              seasonEntry.showTmdbId,
              seasonEntry.seasonNumber,
              {
                force:
                  false,

                maxAgeMinutes:
                  10080,

                syncEpisodes:
                  true,
              }
            );

            syncedSeasonKeys.add(
              `${seasonEntry.showTmdbId}:${seasonEntry.seasonNumber}`
            );
          } catch (
            syncError
          ) {
            console.error(
              "⚠️ TV Time season preview sync failed:",
              {
                showTmdbId:
                  seasonEntry.showTmdbId,

                seasonNumber:
                  seasonEntry.seasonNumber,

                error:
                  syncError.message,
              }
            );
          }
        }

        job.progressPercentage =
          Math.min(
            75,
            10 +
              Math.round(
                (
                  (
                    index + 1
                  ) /
                  Math.max(
                    1,
                    seasonEntries.length
                  )
                ) *
                  65
              )
          );

        job.currentStage =
          `Resolving seasons ${index + 1}/${seasonEntries.length}`;

        if (
          (
            index + 1
          ) % 10 === 0
        ) {
          await job.save();
        }

        await sleep(
          80
        );
      }

      const showTmdbIds =
        [
          ...new Set(
            resolvableRows.map(
              (item) =>
                item.showTmdbId
            )
          ),
        ];

      const seasonNumbers =
        [
          ...new Set(
            resolvableRows.map(
              (item) =>
                item.seasonNumber
            )
          ),
        ];

      const cachedEpisodes =
        showTmdbIds.length > 0
          ? await Episode.find({
              showTmdbId: {
                $in:
                  showTmdbIds,
              },

              seasonNumber: {
                $in:
                  seasonNumbers,
              },
            })
              .select(
                [
                  "_id",
                  "tmdbId",
                  "showTmdbId",
                  "seasonNumber",
                  "episodeNumber",
                  "name",
                  "airDate",
                  "runtime",
                  "stillPath",
                ].join(" ")
              )
              .lean()
          : [];

      const episodeMap =
        new Map(
          cachedEpisodes.map(
            (episode) => [
              `${episode.showTmdbId}:${episode.seasonNumber}:${episode.episodeNumber}`,
              episode,
            ]
          )
        );

      const exactMatches =
        [];

      for (
        const item of resolvableRows
      ) {
        const episode =
          episodeMap.get(
            `${item.showTmdbId}:${item.seasonNumber}:${item.episodeNumber}`
          );

        if (!episode) {
          fallbackCandidates.push({
            ...item,

            originalFailure:
              "missing_tmdb_episode",

            originalReason:
              "No TMDB episode exists at this season and episode position.",
          });

          continue;
        }

        const preview =
          serializeResolvedEpisode({
            item,
            episode,

            resolutionMethod:
              "direct_sxe",
          });

        exactMatches.push(
          preview
        );

        if (
          item.seasonNumber ===
          0
        ) {
          specialIssues.push(
            serializeEpisodeIssue({
              row:
                item.row,

              sourceKey:
                item.sourceKey,

              sourceName:
                item.resolution
                  .sourceName,

              showTmdbId:
                item.showTmdbId,

              status:
                "special",

              reason:
                "This record belongs to TMDB Season 0 and will follow the import-specials setting.",
            })
          );
        }
      }

      let externalIdMatches =
        0;

      let compatibilityMatches =
        0;

      for (
        let index = 0;
        index <
        fallbackCandidates.length;
        index += 1
      ) {
        const item =
          fallbackCandidates[index];

        let fallbackResult =
          await resolveEpisodeByExternalId({
            item,
          });

        if (fallbackResult) {
          externalIdMatches +=
            1;
        } else {
          fallbackResult =
            await resolveEpisodeByCompatibilityOverride({
              item,
            });

          if (fallbackResult) {
            compatibilityMatches +=
              1;
          }
        }

        if (fallbackResult) {
          const preview =
            serializeResolvedEpisode({
              item,
              episode:
                fallbackResult.episode,

              resolutionMethod:
                fallbackResult.resolutionMethod,

              externalSource:
                fallbackResult.externalSource ||
                "",

              compatibilityReason:
                fallbackResult.compatibilityReason ||
                "",
            });

          exactMatches.push(
            preview
          );

          if (
            Number(
              fallbackResult
                .episode
                .seasonNumber
            ) === 0
          ) {
            specialIssues.push(
              serializeEpisodeIssue({
                row:
                  item.row,

                sourceKey:
                  item.sourceKey,

                sourceName:
                  item.resolution
                    ?.sourceName,

                showTmdbId:
                  item.showTmdbId,

                status:
                  "special",

                reason:
                  "This recovered episode belongs to TMDB Season 0.",
              })
            );
          }

          continue;
        }

        if (
          item.originalFailure ===
          "invalid_position"
        ) {
          invalidIssues.push(
            serializeEpisodeIssue({
              row:
                item.row,

              sourceKey:
                item.sourceKey,

              sourceName:
                item.resolution
                  ?.sourceName,

              showTmdbId:
                item.showTmdbId,

              status:
                "invalid_position",

              reason:
                item.originalReason,
            })
          );
        } else {
          missingIssues.push(
            serializeEpisodeIssue({
              row:
                item.row,

              sourceKey:
                item.sourceKey,

              sourceName:
                item.resolution
                  ?.sourceName,

              showTmdbId:
                item.showTmdbId,

              status:
                "missing_tmdb_episode",

              reason:
                item.originalReason,
            })
          );
        }

        manualEpisodeCards.push(
          serializeManualEpisodeCard({
            item,

            status:
              item.originalFailure,

            reason:
              item.originalReason,

            externalLookupAttempted:
              true,
          })
        );

        /*
         * Keep the external lookup gentle. There are normally
         * very few fallback records.
         */
        await sleep(
          80
        );
      }

      const summary = {
        totalSourceEpisodes:
          rows.length,

        exactMatches:
          exactMatches.length,

        directMatches:
          exactMatches.filter(
            (episode) =>
              episode.resolutionMethod ===
              "direct_sxe"
          ).length,

        externalIdMatches,

        compatibilityMatches,

        manualRecoveryRecords:
          blockedIssues.length +
          manualEpisodeCards.length,

        specials:
          specialIssues.length,

        blockedByUnresolvedShows:
          blockedIssues.length,

        invalidPositions:
          invalidIssues.length,

        missingTmdbEpisodes:
          missingIssues.length,

        duplicateSourceRows,

        preservedWatchDates,

        resolvedShows:
          showTmdbIds.length,

        resolvedSeasons:
          seasonEntries.length,

        syncedSeasons:
          syncedSeasonKeys.size,

        generatedAt:
          new Date(),
      };

      const allIssues = [
        ...blockedIssues,
        ...invalidIssues,
        ...missingIssues,
        ...specialIssues,
      ];

      job.episodeResolutionSummary =
        summary;

      /*
       * Store a bounded issue sample in the import job.
       * Exact matches are reproducible from the ZIP and cached
       * metadata, so we avoid bloating the MongoDB document.
       */
      job.episodeResolutionIssues =
        allIssues.slice(
          0,
          500
        );

      job.stats.matchedEpisodes =
        exactMatches.length;

      job.stats.unmatchedEpisodes =
        blockedIssues.length +
        invalidIssues.length +
        missingIssues.length;

      job.status =
        "preview_ready";

      job.progressPercentage =
        100;

      job.currentStage =
        allIssues.some(
          (issue) =>
            issue.status !==
            "special"
        )
          ? "Episode preview ready with issues"
          : "Episode preview ready";

      job.resumeFromStage =
        "episodes_resolved";

      job.warnings =
        uniqueWarningList([
          ...(
            Array.isArray(
              job.warnings
            )
              ? job.warnings
              : []
          ),

          ...parseWarnings,

          ...(blockedIssues.length
            ? [
                {
                  code:
                    "EPISODES_BLOCKED_BY_SHOW",

                  message:
                    "Some episodes belong to shows that still require identification.",

                  count:
                    blockedIssues.length,
                },
              ]
            : []),

          ...(invalidIssues.length
            ? [
                {
                  code:
                    "INVALID_EPISODE_POSITIONS",

                  message:
                    "Some TV Time records have invalid season or episode numbers.",

                  count:
                    invalidIssues.length,
                },
              ]
            : []),

          ...(missingIssues.length
            ? [
                {
                  code:
                    "TMDB_EPISODES_NOT_FOUND",

                  message:
                    "Some TV Time episode positions do not exist in TMDB.",

                  count:
                    missingIssues.length,
                },
              ]
            : []),
        ]);

      await job.save();

      const unresolvedShows =
        job.showResolution
          .filter(
            (show) =>
              ![
                "matched",
                "confirmed",
                "rejected",
              ].includes(
                show.status
              )
          )
          .map(
            (show) => ({
              sourceKey:
                show.sourceKey,

              sourceId:
                show.sourceId,

              sourceName:
                show.sourceName,

              sourceNameMissing:
                show.sourceNameMissing ===
                true,

              reportedEpisodesSeen:
                Number(
                  show.reportedEpisodesSeen ||
                  0
                ),

              recoveredEpisodeCount:
                Number(
                  show.recoveredEpisodeCount ||
                  show.episodeCount ||
                  0
                ),

              episodePattern:
                Array.isArray(
                  show.episodePattern
                )
                  ? show.episodePattern
                  : [],

              firstWatchDate:
                show.firstWatchDate ||
                null,

              lastWatchDate:
                show.lastWatchDate ||
                null,

              episodeCount:
                Number(
                  show.episodeCount ||
                  0
                ),

              status:
                show.status,

              reason:
                show.reason,
            })
          );

      const readyForImport =
        blockedIssues.length === 0 &&
        invalidIssues.length === 0 &&
        missingIssues.length === 0;

      return res
        .status(200)
        .json({
          readyForImport,

          hasRecoverableIssues:
            allIssues.length > 0,

          job: {
            id:
              String(
                job._id
              ),

            status:
              job.status,

            currentStage:
              job.currentStage,

            progressPercentage:
              job.progressPercentage,

            resumeFromStage:
              job.resumeFromStage,
          },

          summary,

          orphanAccuracyCards:
            unresolvedShows.filter(
              (show) =>
                show.sourceNameMissing
            ),

          manualAccuracyCards: [
            ...unresolvedShows
              .filter(
                (show) =>
                  show.sourceNameMissing
              )
              .map(
                (show) => ({
                  type:
                    "show",

                  ...show,
                })
              ),

            ...manualEpisodeCards,
          ],

          unresolvedShows,

          issueCounts: {
            blocked:
              blockedIssues.length,

            invalid:
              invalidIssues.length,

            missing:
              missingIssues.length,

            specials:
              specialIssues.length,
          },

          issuePreview: {
            blocked:
              blockedIssues.slice(
                0,
                50
              ),

            invalid:
              invalidIssues.slice(
                0,
                50
              ),

            missing:
              missingIssues.slice(
                0,
                50
              ),

            specials:
              specialIssues.slice(
                0,
                50
              ),
          },

          matchedPreview:
            exactMatches.slice(
              0,
              30
            ),

          /*
           * Required by the next dry-run planning stage.
           * This still writes no TVLog documents.
           */
          resolvedEpisodes:
            exactMatches,

          recoveryPreview:
            exactMatches
              .filter(
                (episode) =>
                  episode.resolutionMethod !==
                  "direct_sxe"
              )
              .slice(
                0,
                50
              ),
        });
    } catch (error) {
      console.error(
        "❌ TV Time episode resolution failed:",
        error
      );

      try {
        await TVImportJob.findOneAndUpdate(
          {
            _id:
              req.params.jobId,

            user:
              req.user._id,
          },
          {
            $set: {
              status:
                "failed",

              progressPercentage:
                0,

              currentStage:
                "Episode resolution failed",

              errorCode:
                error.code ||
                "EPISODE_RESOLUTION_FAILED",

              errorMessage:
                cleanString(
                  error.message,
                  1000
                ),

              failedStage:
                "episode_resolution",
            },
          }
        );
      } catch (
        updateError
      ) {
        console.error(
          "❌ Could not update failed episode resolution:",
          updateError
        );
      }

      return res
        .status(500)
        .json({
          error:
            "Failed to resolve TV Time episodes.",

          code:
            "EPISODE_RESOLUTION_FAILED",
        });
    }
  }
);


// ========================================================
// POST /api/tv-time-import/:jobId/build-plan
//
// Creates a deterministic dry-run execution plan.
//
// This endpoint:
// - validates the same ZIP hash;
// - validates every supplied resolved episode against the ZIP;
// - creates stable external import IDs;
// - assigns chronological watchNumber values;
// - detects existing imported TVLog documents;
// - persists only a bounded summary.
//
// It creates ZERO TVLog documents.
// ========================================================

router.post(
  "/:jobId/build-plan",
  protect,
  upload.single("file"),
  async (
    req,
    res
  ) => {
    let job = null;

    try {
      job =
        await TVImportJob.findOne({
          _id:
            req.params.jobId,

          user:
            req.user._id,

          source:
            "tv_time",
        });

      if (!job) {
        return res
          .status(404)
          .json({
            error:
              "TV Time import job not found.",
          });
      }

      if (
        !req.file?.buffer
      ) {
        return res
          .status(400)
          .json({
            error:
              "Please upload the same TV Time ZIP file.",

            code:
              "TV_TIME_ARCHIVE_REQUIRED",
          });
      }

      const uploadedHash =
        crypto
          .createHash(
            "sha256"
          )
          .update(
            req.file.buffer
          )
          .digest(
            "hex"
          );

      if (
        job.fileHash &&
        uploadedHash !==
          job.fileHash
      ) {
        return res
          .status(409)
          .json({
            error:
              "This ZIP file does not match the analyzed TV Time archive.",

            code:
              "TV_TIME_ARCHIVE_MISMATCH",
          });
      }

      let suppliedResolvedEpisodes =
        [];

      try {
        suppliedResolvedEpisodes =
          JSON.parse(
            req.body
              ?.resolvedEpisodes ||
            "[]"
          );
      } catch (
        parseError
      ) {
        return res
          .status(400)
          .json({
            error:
              "resolvedEpisodes must be valid JSON.",

            code:
              "INVALID_RESOLVED_EPISODES_JSON",
          });
      }

      if (
        !Array.isArray(
          suppliedResolvedEpisodes
        ) ||
        suppliedResolvedEpisodes.length ===
          0
      ) {
        return res
          .status(400)
          .json({
            error:
              "Resolve the TV Time episodes first and provide the complete resolvedEpisodes array.",

            code:
              "RESOLVED_EPISODES_REQUIRED",
          });
      }

      job.status =
        "parsing";

      job.progressPercentage =
        10;

      job.currentStage =
        "Validating import plan";

      job.lastAttemptAt =
        new Date();

      job.attemptCount =
        Number(
          job.attemptCount ||
          0
        ) + 1;

      await job.save();

      const {
        csvFiles,
      } =
        readTVTimeArchive(
          req.file
        );

      const {
        parsedFiles,
      } =
        parseAvailableFiles(
          csvFiles
        );

      const trackingRows =
        rowsFromFiles(
          parsedFiles,
          [
            "tracking-prod-records-v2.csv",
          ]
        );

      const ratingVoteMap =
        buildTVTimeRatingVoteMap(
          parsedFiles
        );

      const characterVoteMap =
        buildTVTimeCharacterVoteMap(
          parsedFiles
        );

      /*
       * All valid source watch records from the ZIP.
       */
      const sourceRecords =
        new Map();

      for (
        const row of trackingRows
      ) {
        if (
          !isWatchedEpisodeRow(
            row
          )
        ) {
          continue;
        }

        const key =
          makeEpisodeKey(
            row
          );

        if (
          !key ||
          sourceRecords.has(
            key
          )
        ) {
          continue;
        }

        sourceRecords.set(
          key,
          row
        );
      }

      const normalized =
        [];

      let invalidResolvedRows =
        0;

      for (
        const supplied of
        suppliedResolvedEpisodes
      ) {
        const row =
          normalizeResolvedPlanRow(
            supplied
          );

        if (!row) {
          invalidResolvedRows +=
            1;

          continue;
        }

        /*
         * Every planned item must correspond to a genuine source
         * watch row in the uploaded archive.
         */
        const sourceKeyCandidates =
          [
            `episode:${row.sourceEpisodeId}`,
            cleanString(
              supplied?.sourceEpisodeKey,
              500
            ),
          ].filter(Boolean);

        const sourceExists =
          Array.from(
            sourceRecords.values()
          ).some(
            (sourceRow) =>
              episodeIdFromRow(
                sourceRow
              ) ===
              row.sourceEpisodeId
          );

        if (
          !sourceExists
        ) {
          invalidResolvedRows +=
            1;

          continue;
        }

        row.externalImportId =
          buildTVTimeExternalImportId({
            fileHash:
              uploadedHash,

            sourceEpisodeId:
              row.sourceEpisodeId,

            watchDate:
              row.watchDate,

            sourceSeasonNumber:
              row.sourceSeasonNumber,

            sourceEpisodeNumber:
              row.sourceEpisodeNumber,
          });

        normalized.push(
          row
        );
      }

      /*
       * Stable dedupe inside the supplied plan.
       */
      const planByExternalId =
        new Map();

      for (
        const row of normalized
      ) {
        if (
          !planByExternalId.has(
            row.externalImportId
          )
        ) {
          planByExternalId.set(
            row.externalImportId,
            row
          );
        }
      }

      const deduplicatedPlan =
        assignImportWatchNumbers(
          Array.from(
            planByExternalId.values()
          )
        );

      const {
        ratingsPreserved,
        characterVotesPreserved,
      } =
        attachTVTimeEpisodeMetadata({
          rows:
            deduplicatedPlan,

          ratingVoteMap,

          characterVoteMap,
        });

      const externalImportIds =
        deduplicatedPlan.map(
          (row) =>
            row.externalImportId
        );

      const existingLogs =
        externalImportIds.length > 0
          ? await TVLog.find({
              user:
                req.user._id,

              source:
                "tv_time_import",

              externalImportId: {
                $in:
                  externalImportIds,
              },
            })
              .select(
                "_id externalImportId"
              )
              .lean()
          : [];

      const existingIds =
        new Set(
          existingLogs.map(
            (log) =>
              String(
                log.externalImportId
              )
          )
        );

      const readyRows =
        deduplicatedPlan.filter(
          (row) =>
            !existingIds.has(
              row.externalImportId
            )
        );

      const alreadyImportedRows =
        deduplicatedPlan.filter(
          (row) =>
            existingIds.has(
              row.externalImportId
            )
        );

      const skippedUnresolved =
        Number(
          job.episodeResolutionSummary
            ?.blockedByUnresolvedShows ||
          0
        ) +
        Number(
          job.episodeResolutionSummary
            ?.invalidPositions ||
          0
        ) +
        Number(
          job.episodeResolutionSummary
            ?.missingTmdbEpisodes ||
          0
        );

      /*
       * Specials are included in the dry-run plan for now.
       * The execution endpoint will honor job.options.importSpecials.
       */
      const skippedSpecials =
        0;

      const showsAffected =
        new Set(
          readyRows.map(
            (row) =>
              row.showTmdbId
          )
        ).size;

      const uniqueEpisodesAffected =
        new Set(
          readyRows.map(
            (row) =>
              `${row.showTmdbId}:${row.seasonNumber}:${row.episodeNumber}`
          )
        ).size;

      const rewatchLogs =
        readyRows.filter(
          (row) =>
            row.rewatch ===
            true
        ).length;

      const preservedWatchDates =
        readyRows.filter(
          (row) =>
            row.watchDate instanceof
              Date &&
            !Number.isNaN(
              row.watchDate.getTime()
            )
        ).length;

      const totalSourceRecords =
        Number(
          job.episodeResolutionSummary
            ?.totalSourceEpisodes ||
          sourceRecords.size
        );

      const accounted =
        deduplicatedPlan.length +
        skippedUnresolved +
        invalidResolvedRows;

      const accountingDifference =
        totalSourceRecords -
        accounted;

      const planIdentity = {
        jobId:
          String(
            job._id
          ),

        fileHash:
          uploadedHash,

        rows:
          deduplicatedPlan.map(
            (row) => ({
              externalImportId:
                row.externalImportId,

              watchNumber:
                row.watchNumber,

              rewatch:
                row.rewatch,

              sourceRatingVote:
                row.sourceRatingVote ||
                null,

              sourceFavoriteCharacterVote:
                row.sourceFavoriteCharacterVote ||
                null,
            })
          ),
      };

      const planHash =
        crypto
          .createHash(
            "sha256"
          )
          .update(
            stableJSONStringify(
              planIdentity
            )
          )
          .digest(
            "hex"
          );

      const summary = {
        totalSourceRecords,

        resolvedRecords:
          deduplicatedPlan.length,

        readyToCreate:
          readyRows.length,

        alreadyImported:
          alreadyImportedRows.length,

        skippedUnresolved,

        skippedSpecials,

        invalidResolvedRows,

        showsAffected,

        uniqueEpisodesAffected,

        rewatchLogs,

        /*
         * These are losslessly preserved opaque source votes.
         * They are not converted into fabricated Scene ratings
         * or character identities.
         */
        ratingsAttached:
          ratingsPreserved,

        characterVotesAttached:
          characterVotesPreserved,

        preservedWatchDates,

        accountingDifference,

        planHash,

        generatedAt:
          new Date(),
      };

      job.importPlanSummary =
        summary;

      job.status =
        "preview_ready";

      job.progressPercentage =
        100;

      job.currentStage =
        accountingDifference ===
          0
          ? "Import plan ready"
          : "Import plan requires review";

      job.resumeFromStage =
        "import_plan_built";

      job.errorCode =
        "";

      job.errorMessage =
        "";

      job.failedStage =
        "";

      await job.save();

      return res
        .status(200)
        .json({
          readyForExecution:
            accountingDifference ===
              0,

          writesPerformed:
            false,

          summary,

          sourceMetadata: {
            rawRatingRows:
              rowsWithSourceFiles(
                parsedFiles,
                [
                  "ratings-3-prod-episode_votes.csv",
                  "ratings-v2-prod-votes.csv",
                  "ratings-prod-episode_votes.csv",
                  "ratings-live-votes.csv",
                ]
              ).length,

            uniqueEpisodeRatings:
              ratingVoteMap.size,

            ratingsPreserved,

            ratingsRejectedNonTV:
              Math.max(
                0,
                ratingVoteMap.size -
                ratingsPreserved
              ),

            ratingsSafelyConverted:
              0,

            uniqueCharacterVotes:
              characterVoteMap.size,

            characterVotesPreserved,

            characterIdentitiesResolved:
              0,
          },

          /*
           * Full rows are returned so the next execution request
           * can use the exact reviewed plan.
           */
          plan: {
            hash:
              planHash,

            rows:
              deduplicatedPlan.map(
                (row) => ({
                  ...row,

                  watchDate:
                    row.watchDate
                      .toISOString(),
                })
              ),
          },

          preview: {
            readyToCreate:
              readyRows
                .slice(
                  0,
                  30
                )
                .map(
                  (row) => ({
                    externalImportId:
                      row.externalImportId,

                    sourceEpisodeId:
                      row.sourceEpisodeId,

                    sourceName:
                      row.sourceName,

                    showTmdbId:
                      row.showTmdbId,

                    seasonNumber:
                      row.seasonNumber,

                    episodeNumber:
                      row.episodeNumber,

                    watchDate:
                      row.watchDate,

                    watchNumber:
                      row.watchNumber,

                    rewatch:
                      row.rewatch,

                    resolutionMethod:
                      row.resolutionMethod,
                  })
                ),

            alreadyImported:
              alreadyImportedRows
                .slice(
                  0,
                  30
                )
                .map(
                  (row) => ({
                    externalImportId:
                      row.externalImportId,

                    sourceEpisodeId:
                      row.sourceEpisodeId,
                  })
                ),
          },
        });
    } catch (error) {
      console.error(
        "❌ TV Time import plan failed:",
        error
      );

      if (job) {
        try {
          job.status =
            "failed";

          job.progressPercentage =
            0;

          job.currentStage =
            "Import plan failed";

          job.errorCode =
            error.code ||
            "IMPORT_PLAN_FAILED";

          job.errorMessage =
            cleanString(
              error.message,
              1000
            );

          job.failedStage =
            "import_plan";

          await job.save();
        } catch (
          updateError
        ) {
          console.error(
            "❌ Could not update failed import plan:",
            updateError
          );
        }
      }

      return res
        .status(500)
        .json({
          error:
            "Failed to build TV Time import plan.",

          code:
            "IMPORT_PLAN_FAILED",
        });
    }
  }
);


// ========================================================
// POST /api/tv-time-import/:jobId/execute
//
// Execute A:
// - validates the locked V2 plan;
// - verifies all cached show/episode metadata;
// - validates every TVLog document;
// - creates imported logs in resumable idempotent batches;
// - performs no UserShowProgress mutation.
//
// Multipart fields:
// - planHash
// - plan
// ========================================================

router.post(
  "/:jobId/execute",
  protect,
  upload.none(),
  async (
    req,
    res
  ) => {
    let job = null;

    try {
      job =
        await TVImportJob.findOne({
          _id:
            req.params.jobId,

          user:
            req.user._id,

          source:
            "tv_time",
        });

      if (!job) {
        return res
          .status(404)
          .json({
            error:
              "TV Time import job not found.",

            code:
              "TV_TIME_IMPORT_JOB_NOT_FOUND",
          });
      }

      let suppliedPlan =
        null;

      try {
        suppliedPlan =
          JSON.parse(
            req.body?.plan ||
            "null"
          );
      } catch (
        parseError
      ) {
        return res
          .status(400)
          .json({
            error:
              "The execution plan must be valid JSON.",

            code:
              "INVALID_EXECUTION_PLAN_JSON",
          });
      }

      const suppliedPlanHash =
        cleanString(
          req.body?.planHash ||
          suppliedPlan?.hash,
          500
        );

      if (
        !suppliedPlan ||
        !Array.isArray(
          suppliedPlan.rows
        ) ||
        suppliedPlan.rows.length ===
          0
      ) {
        return res
          .status(400)
          .json({
            error:
              "A complete locked import plan is required.",

            code:
              "IMPORT_PLAN_REQUIRED",
          });
      }

      const expectedPlanHash =
        cleanString(
          job.importPlanSummary
            ?.planHash,
          500
        );

      if (
        !expectedPlanHash ||
        !suppliedPlanHash
      ) {
        return res
          .status(409)
          .json({
            error:
              "The import plan has not been locked.",

            code:
              "IMPORT_PLAN_NOT_LOCKED",
          });
      }

      if (
        suppliedPlanHash !==
        expectedPlanHash
      ) {
        return res
          .status(409)
          .json({
            error:
              "The supplied plan hash does not match the locked import plan.",

            code:
              "IMPORT_PLAN_HASH_MISMATCH",

            expectedPlanHash,

            suppliedPlanHash,
          });
      }

      const normalizedRows =
        [];

      const invalidRows =
        [];

      for (
        let index = 0;
        index <
        suppliedPlan.rows.length;
        index += 1
      ) {
        const normalized =
          normalizeExecutionPlanRow(
            suppliedPlan.rows[index]
          );

        if (!normalized) {
          invalidRows.push(
            index
          );

          continue;
        }

        normalizedRows.push(
          normalized
        );
      }

      if (
        invalidRows.length > 0
      ) {
        return res
          .status(400)
          .json({
            error:
              "The locked plan contains invalid execution rows.",

            code:
              "INVALID_EXECUTION_PLAN_ROWS",

            invalidRowCount:
              invalidRows.length,

            invalidRowIndexes:
              invalidRows.slice(
                0,
                50
              ),
          });
      }

      const uniqueExternalIds =
        new Set(
          normalizedRows.map(
            (row) =>
              row.externalImportId
          )
        );

      if (
        uniqueExternalIds.size !==
        normalizedRows.length
      ) {
        return res
          .status(409)
          .json({
            error:
              "The locked plan contains duplicate import identities.",

            code:
              "DUPLICATE_PLAN_IDENTITIES",
          });
      }

      const recalculatedHash =
        calculateExecutionPlanHash({
          job,

          rows:
            normalizedRows,
        });

      if (
        recalculatedHash !==
        expectedPlanHash
      ) {
        return res
          .status(409)
          .json({
            error:
              "The supplied plan contents no longer match the locked plan hash.",

            code:
              "IMPORT_PLAN_CONTENT_MISMATCH",

            expectedPlanHash,

            recalculatedHash,
          });
      }

      const plannedCount =
        Number(
          job.importPlanSummary
            ?.resolvedRecords ||
          0
        );

      if (
        plannedCount !==
        normalizedRows.length
      ) {
        return res
          .status(409)
          .json({
            error:
              "The execution row count does not match the reviewed plan.",

            code:
              "IMPORT_PLAN_COUNT_MISMATCH",

            plannedCount,

            suppliedCount:
              normalizedRows.length,
          });
      }

      /*
       * Resolve every required Scene Show and Episode before
       * allowing the first write.
       */
      const showTmdbIds =
        [
          ...new Set(
            normalizedRows.map(
              (row) =>
                row.showTmdbId
            )
          ),
        ];

      const episodeTmdbIds =
        [
          ...new Set(
            normalizedRows.map(
              (row) =>
                row.episodeTmdbId
            )
          ),
        ];

      const [
        shows,
        episodes,
      ] =
        await Promise.all([
          Show.find({
            tmdbId: {
              $in:
                showTmdbIds,
            },
          })
            .select(
              [
                "_id",
                "tmdbId",
                "name",
                "nameAr",
                "posterPath",
                "backdropPath",
                "firstAirDate",
              ].join(" ")
            )
            .lean(),

          Episode.find({
            tmdbId: {
              $in:
                episodeTmdbIds,
            },
          })
            .select(
              [
                "_id",
                "show",
                "showTmdbId",
                "tmdbId",
                "seasonNumber",
                "episodeNumber",
                "name",
                "overview",
                "airDate",
                "runtime",
                "stillPath",
              ].join(" ")
            )
            .lean(),
        ]);

      const showMap =
        new Map(
          shows.map(
            (show) => [
              Number(
                show.tmdbId
              ),
              show,
            ]
          )
        );

      const episodeMap =
        new Map(
          episodes.map(
            (episode) => [
              Number(
                episode.tmdbId
              ),
              episode,
            ]
          )
        );

      const missingShowIds =
        showTmdbIds.filter(
          (tmdbId) =>
            !showMap.has(
              tmdbId
            )
        );

      const missingEpisodeIds =
        episodeTmdbIds.filter(
          (tmdbId) =>
            !episodeMap.has(
              tmdbId
            )
        );

      if (
        missingShowIds.length > 0 ||
        missingEpisodeIds.length > 0
      ) {
        return res
          .status(409)
          .json({
            error:
              "Some required Scene metadata is missing. No logs were written.",

            code:
              "EXECUTION_METADATA_MISSING",

            missingShowCount:
              missingShowIds.length,

            missingShowIds:
              missingShowIds.slice(
                0,
                50
              ),

            missingEpisodeCount:
              missingEpisodeIds.length,

            missingEpisodeIds:
              missingEpisodeIds.slice(
                0,
                50
              ),
          });
      }

      const documents =
        [];

      const validationErrors =
        [];

      for (
        const row of normalizedRows
      ) {
        const show =
          showMap.get(
            row.showTmdbId
          );

        const episode =
          episodeMap.get(
            row.episodeTmdbId
          );

        if (
          Number(
            episode.showTmdbId
          ) !==
            row.showTmdbId ||
          Number(
            episode.seasonNumber
          ) !==
            row.seasonNumber ||
          Number(
            episode.episodeNumber
          ) !==
            row.episodeNumber
        ) {
          validationErrors.push({
            externalImportId:
              row.externalImportId,

            reason:
              "Episode identity does not match the locked plan.",
          });

          continue;
        }

        const sourceImportMetadata = {
          provider:
            "tv_time",

          sourceEpisodeId:
            row.sourceEpisodeId,

          sourceKey:
            row.sourceKey,

          sourceName:
            row.sourceName,

          sourceSeasonNumber:
            Number.isFinite(
              row.sourceSeasonNumber
            )
              ? row.sourceSeasonNumber
              : null,

          sourceEpisodeNumber:
            Number.isFinite(
              row.sourceEpisodeNumber
            )
              ? row.sourceEpisodeNumber
              : null,

          resolutionMethod:
            row.resolutionMethod,

          opaqueRatingVote:
            row.sourceRatingVote ||
            null,

          opaqueFavoriteCharacterVote:
            row
              .sourceFavoriteCharacterVote ||
            null,

          planHash:
            expectedPlanHash,
        };

        const document =
          new TVLog({
            user:
              req.user._id,

            show:
              show._id,

            showTmdbId:
              row.showTmdbId,

            showName:
              cleanString(
                show.name,
                500
              ) ||
              row.sourceName ||
              `TV Show ${row.showTmdbId}`,

            showPoster:
              cleanString(
                show.posterPath,
                1000
              ),

            showBackdrop:
              cleanString(
                show.backdropPath,
                1000
              ),

            firstAirDate:
              show.firstAirDate
                ? new Date(
                    show.firstAirDate
                  )
                    .toISOString()
                    .slice(
                      0,
                      10
                    )
                : "",

            seasonNumber:
              row.seasonNumber,

            episodeNumber:
              row.episodeNumber,

            episodeTmdbId:
              row.episodeTmdbId,

            episodeName:
              cleanString(
                episode.name,
                1000
              ),

            episodeOverview:
              cleanString(
                episode.overview,
                10000
              ),

            episodeAirDate:
              episode.airDate
                ? new Date(
                    episode.airDate
                  )
                    .toISOString()
                    .slice(
                      0,
                      10
                    )
                : "",

            episodeRuntime:
              Number(
                episode.runtime
              ) || null,

            episodeStillPath:
              cleanString(
                episode.stillPath,
                1000
              ),

            watchedAt:
              row.watchedAt,

            watchNumber:
              row.watchNumber,

            rewatch:
              row.rewatch,

            logMethod:
              "import",

            source:
              "tv_time_import",

            importJob:
              job._id,

            externalImportId:
              row.externalImportId,

            sourceImportMetadata,

            rating:
              null,

            favoriteCharacter:
              null,

            review:
              "",

            containsSpoilers:
              false,

            likes:
              [],

            replies:
              [],

            images:
              [],
          });

        const validationError =
          document.validateSync();

        if (
          validationError
        ) {
          validationErrors.push({
            externalImportId:
              row.externalImportId,

            reason:
              validationError.message,
          });

          continue;
        }

        documents.push(
          document.toObject({
            depopulate:
              true,

            versionKey:
              false,
          })
        );
      }

      if (
        validationErrors.length > 0 ||
        documents.length !==
          normalizedRows.length
      ) {
        return res
          .status(409)
          .json({
            error:
              "Some imported TV logs failed pre-write validation. No logs were written.",

            code:
              "TV_LOG_PREWRITE_VALIDATION_FAILED",

            validationErrorCount:
              validationErrors.length,

            validationErrors:
              validationErrors.slice(
                0,
                50
              ),
          });
      }

      const externalIdList =
        Array.from(
          uniqueExternalIds
        );

      const beforeCount =
        await TVLog.countDocuments({
          user:
            req.user._id,

          source:
            "tv_time_import",

          externalImportId: {
            $in:
              externalIdList,
          },
        });

      job.status =
        "importing";

      job.progressPercentage =
        Math.max(
          1,
          Math.min(
            95,
            Math.round(
              (
                beforeCount /
                normalizedRows.length
              ) *
                95
            )
          )
        );

      job.currentStage =
        `Writing TV logs ${beforeCount}/${normalizedRows.length}`;

      job.lastAttemptAt =
        new Date();

      job.attemptCount =
        Number(
          job.attemptCount ||
          0
        ) + 1;

      job.errorCode =
        "";

      job.errorMessage =
        "";

      job.failedStage =
        "";

      await job.save();

      const batches =
        chunkArray(
          documents,
          100
        );

      let processed =
        beforeCount;

      for (
        let batchIndex = 0;
        batchIndex <
        batches.length;
        batchIndex += 1
      ) {
        const batch =
          batches[
            batchIndex
          ];

        const operations =
          batch.map(
            (document) => ({
              updateOne: {
                filter: {
                  user:
                    req.user._id,

                  source:
                    "tv_time_import",

                  externalImportId:
                    document
                      .externalImportId,
                },

                update: {
                  $setOnInsert:
                    document,
                },

                upsert:
                  true,
              },
            })
          );

        await TVLog.bulkWrite(
          operations,
          {
            ordered:
              false,
          }
        );

        processed =
          await TVLog.countDocuments({
            user:
              req.user._id,

            source:
              "tv_time_import",

            externalImportId: {
              $in:
                externalIdList,
            },
          });

        job.progressPercentage =
          Math.max(
            1,
            Math.min(
              95,
              Math.round(
                (
                  processed /
                  normalizedRows.length
                ) *
                  95
              )
            )
          );

        job.currentStage =
          `Writing TV logs ${processed}/${normalizedRows.length}`;

        job.stats.logsCreated =
          processed;

        job.stats.duplicateLogsSkipped =
          beforeCount;

        job.resumeFromStage =
          "writing_tv_logs";

        await job.save();
      }

      const finalCount =
        await TVLog.countDocuments({
          user:
            req.user._id,

          source:
            "tv_time_import",

          externalImportId: {
            $in:
              externalIdList,
          },
        });

      if (
        finalCount !==
        normalizedRows.length
      ) {
        job.status =
          "failed";

        job.progressPercentage =
          Math.min(
            95,
            Math.round(
              (
                finalCount /
                normalizedRows.length
              ) *
                95
            )
          );

        job.currentStage =
          "TV log verification failed";

        job.errorCode =
          "TV_LOG_COUNT_VERIFICATION_FAILED";

        job.errorMessage =
          `Expected ${normalizedRows.length} imported TV logs but found ${finalCount}.`;

        job.failedStage =
          "writing_tv_logs";

        job.stats.logsCreated =
          finalCount;

        await job.save();

        return res
          .status(500)
          .json({
            error:
              job.errorMessage,

            code:
              job.errorCode,

            expected:
              normalizedRows.length,

            actual:
              finalCount,

            resumable:
              true,
          });
      }

      const insertedThisRun =
        Math.max(
          0,
          finalCount -
          beforeCount
        );

      job.status =
        "importing";

      job.progressPercentage =
        95;

      job.currentStage =
        "TV logs safely written; progress rebuild pending";

      job.resumeFromStage =
        "tv_logs_inserted";

      job.stats.logsCreated =
        finalCount;

      job.stats.duplicateLogsSkipped =
        beforeCount;

      job.stats.ratingsImported =
        0;

      job.errorCode =
        "";

      job.errorMessage =
        "";

      job.failedStage =
        "";

      await job.save();

      return res
        .status(200)
        .json({
          success:
            true,

          stage:
            "tv_logs_inserted",

          planHash:
            expectedPlanHash,

          expectedLogs:
            normalizedRows.length,

          existingBeforeExecution:
            beforeCount,

          insertedThisRun,

          verifiedImportedLogs:
            finalCount,

          batchSize:
            100,

          batchesProcessed:
            batches.length,

          resumable:
            true,

          idempotent:
            true,

          progressRebuilt:
            false,

          nextStage:
            "rebuild_user_show_progress",
        });
    } catch (error) {
      console.error(
        "❌ TV Time execution failed:",
        error
      );

      if (job) {
        try {
          job.status =
            "failed";

          job.currentStage =
            "TV log execution failed";

          job.errorCode =
            error.code ||
            "TV_TIME_EXECUTION_FAILED";

          job.errorMessage =
            cleanString(
              error.message,
              1000
            );

          job.failedStage =
            "writing_tv_logs";

          job.resumeFromStage =
            "writing_tv_logs";

          await job.save();
        } catch (
          updateError
        ) {
          console.error(
            "❌ Could not record TV Time execution failure:",
            updateError
          );
        }
      }

      return res
        .status(500)
        .json({
          error:
            "Failed to execute the TV Time import.",

          code:
            "TV_TIME_EXECUTION_FAILED",

          details:
            cleanString(
              error.message,
              1000
            ),

          resumable:
            true,
        });
    }
  }
);


// ========================================================
// POST /api/tv-time-import/:jobId/rebuild-progress
//
// Execute B:
// - verifies Execute A imported every locked log;
// - rebuilds all UserShowProgress documents from the user's
//   complete Scene TV diary;
// - refreshes cached user TV statistics;
// - marks the import completed.
//
// Safe to rerun.
// ========================================================

router.post(
  "/:jobId/rebuild-progress",
  protect,
  async (
    req,
    res
  ) => {
    let job = null;

    try {
      job =
        await TVImportJob.findOne({
          _id:
            req.params.jobId,

          user:
            req.user._id,

          source:
            "tv_time",
        });

      if (!job) {
        return res
          .status(404)
          .json({
            error:
              "TV Time import job not found.",

            code:
              "TV_TIME_IMPORT_JOB_NOT_FOUND",
          });
      }

      const expectedImportedLogs =
        Number(
          job.importPlanSummary
            ?.resolvedRecords ||
          0
        );

      const lockedPlanHash =
        cleanString(
          job.importPlanSummary
            ?.planHash,
          500
        );

      if (
        expectedImportedLogs < 1 ||
        !lockedPlanHash
      ) {
        return res
          .status(409)
          .json({
            error:
              "A locked and executed import plan is required first.",

            code:
              "EXECUTED_IMPORT_PLAN_REQUIRED",
          });
      }

      const verifiedImportedLogs =
        await TVLog.countDocuments({
          user:
            req.user._id,

          source:
            "tv_time_import",

          importJob:
            job._id,

          "sourceImportMetadata.planHash":
            lockedPlanHash,
        });

      if (
        verifiedImportedLogs !==
        expectedImportedLogs
      ) {
        return res
          .status(409)
          .json({
            error:
              "The imported TV log count does not match the locked plan. Progress was not rebuilt.",

            code:
              "IMPORTED_LOG_VERIFICATION_FAILED",

            expectedImportedLogs,

            verifiedImportedLogs,

            resumable:
              true,
          });
      }

      job.status =
        "importing";

      job.progressPercentage =
        96;

      job.currentStage =
        "Rebuilding TV show progress";

      job.resumeFromStage =
        "rebuilding_user_show_progress";

      job.lastAttemptAt =
        new Date();

      job.attemptCount =
        Number(
          job.attemptCount ||
          0
        ) + 1;

      job.errorCode =
        "";

      job.errorMessage =
        "";

      job.failedStage =
        "";

      await job.save();

      /*
       * This intentionally uses the user's complete TVLog history.
       *
       * Existing manual Scene logs and imported logs are combined,
       * so progress remains correct for mixed histories.
       */
      const rebuildResult =
        await rebuildAllUserShowProgress(
          req.user._id
        );

      job.progressPercentage =
        98;

      job.currentStage =
        "Verifying rebuilt TV statistics";

      await job.save();

      const progressDocuments =
        await UserShowProgress.find({
          user:
            req.user._id,
        })
          .select(
            [
              "status",
              "watchedEpisodeCount",
              "watchedSpecialCount",
              "completedSeasonCount",
              "totalWatchCount",
              "rewatchCount",
              "totalWatchMinutes",
            ].join(" ")
          )
          .lean();

      const cachedStats =
        progressDocuments.reduce(
          (
            result,
            progress
          ) => {
            result.totalEpisodeWatches +=
              Number(
                progress.totalWatchCount ||
                0
              );

            result.totalUniqueEpisodesWatched +=
              Number(
                progress.watchedEpisodeCount ||
                0
              );

            result.totalEpisodeRewatches +=
              Number(
                progress.rewatchCount ||
                0
              );

            result.totalTVWatchMinutes +=
              Number(
                progress.totalWatchMinutes ||
                0
              );

            result.totalSeasonsCompleted +=
              Number(
                progress.completedSeasonCount ||
                0
              );

            result.totalShowsStarted +=
              1;

            if (
              progress.status ===
              "completed"
            ) {
              result.totalShowsCompleted +=
                1;
            }

            return result;
          },
          {
            totalEpisodeWatches:
              0,

            totalUniqueEpisodesWatched:
              0,

            totalEpisodeRewatches:
              0,

            totalTVWatchMinutes:
              0,

            totalSeasonsCompleted:
              0,

            totalShowsStarted:
              0,

            totalShowsCompleted:
              0,
          }
        );

      const completedAt =
        new Date();

      const updatedUser =
        await User.findByIdAndUpdate(
          req.user._id,
          {
            $set: {
              ...cachedStats,

              tvStatsCalculatedAt:
                completedAt,

              "tvImportStatus.hasImported":
                true,

              "tvImportStatus.lastImportedAt":
                completedAt,

              "tvImportStatus.latestImportJob":
                job._id,
            },
          },
          {
            new:
              true,

            runValidators:
              true,
          }
        )
          .select(
            [
              "_id",
              "username",
              "totalEpisodeWatches",
              "totalUniqueEpisodesWatched",
              "totalEpisodeRewatches",
              "totalTVWatchMinutes",
              "totalSeasonsCompleted",
              "totalShowsStarted",
              "totalShowsCompleted",
              "tvStatsCalculatedAt",
              "tvImportStatus",
            ].join(" ")
          )
          .lean();

      if (!updatedUser) {
        throw new Error(
          "User document was not found while finalizing the import."
        );
      }

      const failedCount =
        Number(
          rebuildResult
            ?.failedCount ||
          0
        );

      const rebuiltCount =
        Number(
          rebuildResult
            ?.rebuiltCount ||
          0
        );

      const totalShows =
        Number(
          rebuildResult
            ?.totalShows ||
          0
        );

      const progressDocumentCount =
        progressDocuments.length;

      /*
       * A failure in any show must be visible rather than silently
       * declaring the import completely successful.
       */
      job.status =
        failedCount > 0
          ? "completed_with_errors"
          : "completed";

      job.progressPercentage =
        100;

      job.currentStage =
        failedCount > 0
          ? "TV import completed with progress warnings"
          : "TV Time import completed";

      job.resumeFromStage =
        "completed";

      job.completedAt =
        completedAt;

      job.stats.logsCreated =
        verifiedImportedLogs;

      job.stats.duplicateLogsSkipped =
        Math.max(
          0,
          Number(
            job.stats
              ?.duplicateLogsSkipped ||
            0
          )
        );

      job.stats.errors =
        failedCount;

      job.errorCode =
        failedCount > 0
          ? "PROGRESS_REBUILD_PARTIAL_FAILURE"
          : "";

      job.errorMessage =
        failedCount > 0
          ? `${failedCount} show progress document(s) could not be rebuilt.`
          : "";

      job.failedStage =
        failedCount > 0
          ? "rebuilding_user_show_progress"
          : "";

      if (
        failedCount > 0
      ) {
        job.warnings =
          uniqueWarningList([
            ...(
              Array.isArray(
                job.warnings
              )
                ? job.warnings
                : []
            ),

            {
              code:
                "PROGRESS_REBUILD_PARTIAL_FAILURE",

              message:
                "Some show progress documents could not be rebuilt.",

              count:
                failedCount,
            },
          ]);
      }

      await job.save();

      const importedWatchCount =
        await TVLog.countDocuments({
          user:
            req.user._id,

          source:
            "tv_time_import",

          importJob:
            job._id,
        });

      const allUserTVLogCount =
        await TVLog.countDocuments({
          user:
            req.user._id,
        });

      return res
        .status(
          failedCount > 0
            ? 207
            : 200
        )
        .json({
          success:
            failedCount === 0,

          completed:
            true,

          status:
            job.status,

          stage:
            "completed",

          planHash:
            lockedPlanHash,

          importedLogsVerified:
            importedWatchCount,

          totalUserTVLogs:
            allUserTVLogCount,

          progress: {
            totalShows,

            rebuiltCount,

            failedCount,

            progressDocumentCount,

            failures:
              Array.isArray(
                rebuildResult?.failed
              )
                ? rebuildResult.failed
                    .slice(
                      0,
                      50
                    )
                : [],
          },

          cachedStats,

          importStatus:
            updatedUser
              .tvImportStatus,

          idempotent:
            true,

          completedAt,
        });
    } catch (error) {
      console.error(
        "❌ TV Time Execute B failed:",
        error
      );

      if (job) {
        try {
          job.status =
            "failed";

          job.currentStage =
            "TV progress rebuild failed";

          job.errorCode =
            error.code ||
            "TV_TIME_PROGRESS_REBUILD_FAILED";

          job.errorMessage =
            cleanString(
              error.message,
              1000
            );

          job.failedStage =
            "rebuilding_user_show_progress";

          job.resumeFromStage =
            "tv_logs_inserted";

          await job.save();
        } catch (
          updateError
        ) {
          console.error(
            "❌ Could not record Execute B failure:",
            updateError
          );
        }
      }

      return res
        .status(500)
        .json({
          error:
            "Failed to rebuild TV progress.",

          code:
            "TV_TIME_PROGRESS_REBUILD_FAILED",

          details:
            cleanString(
              error.message,
              1000
            ),

          logsRemainSafe:
            true,

          resumable:
            true,
        });
    }
  }
);

// ========================================================
// Multer / upload errors
// ========================================================

router.use(
  (
    error,
    req,
    res,
    next
  ) => {
    if (
      error instanceof
      multer.MulterError
    ) {
      if (
        error.code ===
        "LIMIT_FILE_SIZE"
      ) {
        return res
          .status(413)
          .json({
            error:
              "TV Time ZIP file must be 30 MB or smaller.",

            code:
              "TV_TIME_ZIP_TOO_LARGE",
          });
      }

      return res
        .status(400)
        .json({
          error:
            "Only one valid TV Time ZIP file may be uploaded.",

          code:
            error.code,
        });
    }

    if (
      error?.code ===
      "INVALID_TV_TIME_ARCHIVE"
    ) {
      return res
        .status(400)
        .json({
          error:
            error.message,

          code:
            error.code,
        });
    }

    return next(
      error
    );
  }
);

module.exports =
  router;
