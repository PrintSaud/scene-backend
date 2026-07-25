// Users/saudceo/flick-backend/src/routes/importRoutes.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const Papa = require("papaparse");

const router = express.Router();

const Log = require("../models/log");
const Movie = require("../models/movieModel");
const User = require("../models/user");
const List = require("../models/list");

const protect = require("../middleware/authMiddleware");
const {
  findValidTMDBMatch,
} = require("../utils/tmdbUtils");

const MAX_UPLOAD_SIZE =
  10 * 1024 * 1024;

const MAX_CSV_ROWS = 10000;

const storage = multer.memoryStorage();

const upload = multer({
  storage,

  limits: {
    fileSize: MAX_UPLOAD_SIZE,
    files: 1,
  },

  fileFilter: (
    req,
    file,
    callback
  ) => {
    const extension = path
      .extname(file.originalname || "")
      .toLowerCase();

    const allowedMimeTypes = new Set([
      "text/csv",
      "text/plain",
      "application/csv",
      "application/vnd.ms-excel",
      "application/octet-stream",
    ]);

    if (
      extension === ".csv" &&
      allowedMimeTypes.has(file.mimetype)
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

// ============================================================
// HELPERS
// ============================================================

const delay = (milliseconds) =>
  new Promise((resolve) =>
    setTimeout(resolve, milliseconds)
  );

const normalizeTitle = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const createImportSessionId = (
  type,
  userId
) =>
  [
    "letterboxd",
    type,
    String(userId || "unknown"),
    Date.now().toString(36),
    Math.random()
      .toString(36)
      .slice(2, 8),
  ].join("-");

const logImportEvent = (
  sessionId,
  event,
  details = {}
) => {
  console.log(
    JSON.stringify({
      scope:
        "letterboxd-import",

      sessionId,
      event,

      timestamp:
        new Date().toISOString(),

      ...details,
    })
  );
};

const parseBoolean = (value) => {
  if (
    value === true ||
    value === 1
  ) {
    return true;
  }

  const normalized =
    String(value || "")
      .trim()
      .toLowerCase();

  return [
    "true",
    "yes",
    "y",
    "1",
  ].includes(normalized);
};

const cleanString = (
  value,
  maximumLength = 500
) =>
  String(value || "")
    .trim()
    .slice(0, maximumLength);

const parseYear = (value) => {
  const year = Number(value);
  const currentYear =
    new Date().getFullYear() + 5;

  if (
    !Number.isInteger(year) ||
    year < 1870 ||
    year > currentYear
  ) {
    return null;
  }

  return year;
};

const parseRating = (value) => {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return 0;
  }

  const rating = Number(value);

  if (
    !Number.isFinite(rating) ||
    rating < 0 ||
    rating > 5
  ) {
    return 0;
  }

  return rating;
};

const parseWatchedDate = (value) => {
  if (!value) {
    return new Date();
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return new Date();
  }

  return date;
};

const parseCsvFile = (file) => {
  if (!file?.buffer) {
    return {
      error: "No file uploaded",
    };
  }

  const csv = file.buffer.toString(
    "utf-8"
  );

  const parsed = Papa.parse(csv, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) =>
      String(header || "").trim(),
  });

  if (
    Array.isArray(parsed.errors) &&
    parsed.errors.length
  ) {
    const seriousError =
      parsed.errors.find(
        (error) =>
          error.type === "Quotes" ||
          error.type === "Delimiter"
      );

    if (seriousError) {
      return {
        error:
          "The uploaded CSV could not be parsed",
      };
    }
  }

  const rows = Array.isArray(
    parsed.data
  )
    ? parsed.data.slice(0, MAX_CSV_ROWS)
    : [];

  if (!rows.length) {
    return {
      error:
        "The uploaded CSV contains no rows",
    };
  }

  return {
    rows,
    truncated:
      parsed.data.length >
      MAX_CSV_ROWS,
  };
};

const createExternalListId = (
  metadata,
  originalFileName
) => {
  const url =
    cleanString(
      metadata?.URL ||
        metadata?.Url ||
        metadata?.url,
      1000
    );

  if (url) {
    const match =
      url.match(
        /boxd\.it\/([^/?#]+)/i
      );

    if (match?.[1]) {
      return (
        "letterboxd-list-" +
        match[1]
          .trim()
          .toLowerCase()
      );
    }
  }

  const title =
    cleanString(
      metadata?.Name ||
        metadata?.Title ||
        "",
      300
    );

  const fileName =
    cleanString(
      originalFileName,
      300
    );

  const normalized =
    normalizeTitle(
      title ||
      fileName ||
      "untitled-list"
    )
      .replace(/\s+/g, "-")
      .slice(0, 160);

  return (
    "letterboxd-list-" +
    normalized
  );
};

const parseLetterboxdListFile = (
  file
) => {
  if (!file?.buffer) {
    return {
      error:
        "No file uploaded",
    };
  }

  const raw =
    file.buffer.toString(
      "utf-8"
    );

  const normalized =
    raw
      .replace(/^\uFEFF/, "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");

  const lines =
    normalized.split("\n");

  const itemHeaderIndex =
    lines.findIndex((line) =>
      /^Position,Name,Year,/i.test(
        String(line || "").trim()
      )
    );

  if (itemHeaderIndex === -1) {
    return {
      error:
        "This is not a Letterboxd list-content CSV. Select an individual exported list file, not lists.csv.",
    };
  }

  const metadataHeaderIndex =
    lines.findIndex(
      (line, index) =>
        index < itemHeaderIndex &&
        /^Date,Name,Tags,URL,Description/i.test(
          String(line || "").trim()
        )
    );

  if (
    metadataHeaderIndex === -1 ||
    metadataHeaderIndex + 1 >=
      itemHeaderIndex
  ) {
    return {
      error:
        "The Letterboxd list metadata could not be read.",
    };
  }

  const metadataCsv =
    [
      lines[
        metadataHeaderIndex
      ],
      lines[
        metadataHeaderIndex + 1
      ],
    ].join("\n");

  const metadataParsed =
    Papa.parse(
      metadataCsv,
      {
        header: true,
        skipEmptyLines:
          "greedy",
        transformHeader:
          (header) =>
            String(
              header || ""
            ).trim(),
      }
    );

  const metadata =
    metadataParsed
      ?.data?.[0] ||
    {};

  const itemsCsv =
    lines
      .slice(itemHeaderIndex)
      .join("\n");

  const itemsParsed =
    Papa.parse(
      itemsCsv,
      {
        header: true,
        skipEmptyLines:
          "greedy",
        transformHeader:
          (header) =>
            String(
              header || ""
            ).trim(),
      }
    );

  const rows =
    Array.isArray(
      itemsParsed.data
    )
      ? itemsParsed.data
          .slice(
            0,
            MAX_CSV_ROWS
          )
          .filter(
            (row) =>
              row &&
              Object.values(row)
                .some(
                  (value) =>
                    String(
                      value || ""
                    ).trim()
                )
          )
      : [];

  if (!rows.length) {
    return {
      error:
        "This Letterboxd list contains no movie rows.",
    };
  }

  const title =
    cleanString(
      metadata.Name ||
        metadata.Title,
      120
    );

  if (!title) {
    return {
      error:
        "The Letterboxd list has no title.",
    };
  }

  return {
    metadata,
    rows,

    title,

    description:
      cleanString(
        metadata.Description,
        2000
      ),

    tags:
      cleanString(
        metadata.Tags,
        1000
      ),

    externalImportId:
      createExternalListId(
        metadata,
        file.originalname
      ),

    truncated:
      itemsParsed.data.length >
      MAX_CSV_ROWS,
  };
};

const normalizeWatchlist = (
  watchlist
) => {
  if (!Array.isArray(watchlist)) {
    return [];
  }

  const seen = new Set();
  const cleaned = [];

  for (const rawItem of watchlist) {
    if (
      !rawItem ||
      typeof rawItem !== "object"
    ) {
      continue;
    }

    const item =
      typeof rawItem.toObject ===
      "function"
        ? rawItem.toObject()
        : rawItem;

    const tmdbId = Number(
      item.tmdbId
    );

    if (
      !Number.isInteger(tmdbId) ||
      tmdbId <= 0 ||
      seen.has(tmdbId)
    ) {
      continue;
    }

    seen.add(tmdbId);

    cleaned.push({
      ...item,
      tmdbId,
    });
  }

  return cleaned;
};

const createMovieUpsert = (
  movieData
) => ({
  updateOne: {
    filter: {
      tmdbId: Number(movieData.id),
    },

    update: {
      $setOnInsert: {
        tmdbId:
          Number(movieData.id),

        title:
          movieData.title ||
          movieData.name ||
          "Untitled",

        posterPath:
          movieData.poster_path ||
          "",

        backdropPath:
          movieData.backdrop_path ||
          "",

        releaseDate:
          movieData.release_date ||
          null,
      },
    },

    upsert: true,
  },
});

async function resolveMovieMatches(
  rows
) {
  const matches = [];
  const seenInputRows = new Set();

  for (const row of rows) {
    const title = cleanString(
      row.Name ||
        row.Title ||
        row.name ||
        row.title,
      500
    );

    const year = parseYear(
      row.Year ||
        row.year
    );

    if (!title || !year) {
      continue;
    }

    const inputKey =
      `${normalizeTitle(title)}-${year}`;

    if (seenInputRows.has(inputKey)) {
      continue;
    }

    seenInputRows.add(inputKey);

    try {
      const movieData =
        await findValidTMDBMatch(
          title,
          year
        );

      if (
        !movieData ||
        !Number.isInteger(
          Number(movieData.id)
        ) ||
        Number(movieData.id) <= 0
      ) {
        continue;
      }

      matches.push({
        row,
        title,
        year,
        movieData,
      });
    } catch (error) {
      console.warn(
        `⚠️ TMDB match failed for "${title}" (${year}):`,
        error.message
      );
    }

    /*
     * Keep TMDB traffic controlled while
     * processing large imports.
     */
    await delay(150);
  }

  return matches;
}

const startOfUtcDay = (value) => {
  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate()
    )
  );
};

const addUtcDays = (
  value,
  amount
) => {
  const date =
    new Date(value);

  date.setUTCDate(
    date.getUTCDate() +
    amount
  );

  return date;
};

const getImportFileKind = (
  rows,
  originalFileName = ""
) => {
  const normalizedName =
    String(
      originalFileName || ""
    )
      .trim()
      .toLowerCase();

  const firstRow =
    rows?.[0] || {};

  const headers =
    new Set(
      Object.keys(firstRow)
        .map((header) =>
          String(header)
            .trim()
            .toLowerCase()
        )
    );

  if (
    normalizedName.includes(
      "diary"
    ) ||
    headers.has("watched date") ||
    headers.has("rewatch")
  ) {
    return "diary";
  }

  if (
    normalizedName.includes(
      "ratings"
    ) ||
    headers.has("rating")
  ) {
    return "ratings";
  }

  return "unknown";
};

const getLetterboxdWatchedDate = (
  row,
  fileKind
) => {
  if (fileKind === "diary") {
    return parseWatchedDate(
      row["Watched Date"] ||
        row.WatchedDate ||
        row.watchedDate ||
        row.Date ||
        row.date
    );
  }

  return parseWatchedDate(
    row.Date ||
      row.date
  );
};

const findLogOnUtcDay = (
  logs,
  watchedAt
) => {
  const dayStart =
    startOfUtcDay(watchedAt);

  if (!dayStart) {
    return null;
  }

  const dayEnd =
    addUtcDays(
      dayStart,
      1
    );

  return (
    logs.find((log) => {
      const timestamp =
        new Date(
          log.watchedAt
        ).getTime();

      return (
        Number.isFinite(
          timestamp
        ) &&
        timestamp >=
          dayStart.getTime() &&
        timestamp <
          dayEnd.getTime()
      );
    }) ||
    null
  );
};

const sortLogsNewestFirst = (
  logs
) =>
  [...logs].sort(
    (left, right) =>
      new Date(
        right.watchedAt ||
          right.createdAt ||
          0
      ).getTime() -
      new Date(
        left.watchedAt ||
          left.createdAt ||
          0
      ).getTime()
  );

async function synchronizeTotalLogs(
  userId
) {
  const totalLogs =
    await Log.countDocuments({
      user: userId,
    });

  await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        totalLogs,
      },
    }
  );

  return totalLogs;
}

// ============================================================
// LETTERBOXD WATCHLIST IMPORT
// ============================================================

// POST /api/import/watchlist
router.post(
  "/watchlist",
  protect,
  upload.single("file"),
  async (req, res) => {
    const sessionId =
      createImportSessionId(
        "watchlist",
        req.user?._id
      );

    const startedAt = Date.now();

    try {
      logImportEvent(
        sessionId,
        "IMPORT_SESSION_START",
        {
          type:
            "watchlist",

          originalFileName:
            req.file?.originalname ||
            "",

          sizeBytes:
            Number(
              req.file?.size || 0
            ),
        }
      );

      const parsed = parseCsvFile(
        req.file
      );

      if (parsed.error) {
        return res.status(400).json({
          message: parsed.error,
        });
      }

      const user = await User.findById(
        req.user._id
      );

      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      const watchlist =
        normalizeWatchlist(
          user.watchlist
        );

      const existingMovieIds = new Set(
        watchlist.map((item) =>
          Number(item.tmdbId)
        )
      );

      const matches =
        await resolveMovieMatches(
          parsed.rows
        );

      const movieUpserts = [];
      let added = 0;
      let duplicates = 0;

      for (const match of matches) {
        const movieId = Number(
          match.movieData.id
        );

        if (
          existingMovieIds.has(movieId)
        ) {
          duplicates += 1;
          continue;
        }

        existingMovieIds.add(movieId);

        watchlist.push({
          tmdbId: movieId,

          title:
            match.movieData.title ||
            match.title,

          poster_path:
            match.movieData
              .poster_path ||
            null,

          release_date:
            match.movieData
              .release_date ||
            null,

          addedAt: new Date(),
        });

        movieUpserts.push(
          createMovieUpsert(
            match.movieData
          )
        );

        added += 1;
      }

      user.watchlist = watchlist;

      await user.save();

      if (movieUpserts.length) {
        try {
          await Movie.bulkWrite(
            movieUpserts,
            {
              ordered: false,
            }
          );
        } catch (bulkError) {
          console.warn(
            "⚠️ Movie cache upsert partially failed:",
            bulkError.message
          );
        }
      }

      return res.json({
        message:
          `✅ Added ${added} movies to your watchlist!`,

        added,
        duplicates,
        matched: matches.length,
        processed: parsed.rows.length,
        totalWatchlist:
          watchlist.length,

        truncated:
          Boolean(parsed.truncated),
      });
    } catch (error) {
      console.error(
        "❌ Watchlist import failed:",
        error
      );

      return res.status(500).json({
        message: "Import failed",
      });
    }
  }
);



// ============================================================
// LETTERBOXD LIST IMPORT
// ============================================================

// POST /api/import/lists
router.post(
  "/lists",
  protect,
  upload.single("file"),
  async (req, res) => {
    const sessionId =
      createImportSessionId(
        "lists",
        req.user?._id
      );

    const startedAt =
      Date.now();

    try {
      logImportEvent(
        sessionId,
        "IMPORT_SESSION_START",
        {
          type: "lists",

          userId:
            String(
              req.user?._id ||
              ""
            ),

          originalFileName:
            req.file?.originalname ||
            "",

          mimeType:
            req.file?.mimetype ||
            "",

          sizeBytes:
            Number(
              req.file?.size ||
              0
            ),
        }
      );

      const parsed =
        parseLetterboxdListFile(
          req.file
        );

      if (parsed.error) {
        logImportEvent(
          sessionId,
          "LIST_PARSE_FAILED",
          {
            reason:
              parsed.error,

            originalFileName:
              req.file?.originalname ||
              "",
          }
        );

        return res
          .status(400)
          .json({
            message:
              parsed.error,

            sessionId,
          });
      }

      const userExists =
        await User.exists({
          _id:
            req.user._id,
        });

      if (!userExists) {
        return res
          .status(404)
          .json({
            message:
              "User not found",

            sessionId,
          });
      }

      logImportEvent(
        sessionId,
        "LIST_CSV_PARSED",
        {
          title:
            parsed.title,

          description:
            parsed.description,

          externalImportId:
            parsed.externalImportId,

          itemRows:
            parsed.rows.length,

          headers:
            Object.keys(
              parsed.rows[0] ||
              {}
            ),

          truncated:
            Boolean(
              parsed.truncated
            ),
        }
      );

      const preparedRows = [];

      let skippedMissingIdentity =
        0;

      for (
        let index = 0;
        index <
        parsed.rows.length;
        index += 1
      ) {
        const row =
          parsed.rows[index];

        const title =
          cleanString(
            row.Name ||
              row.Title ||
              row.name ||
              row.title,
            500
          );

        const year =
          parseYear(
            row.Year ||
              row.year
          );

        const position =
          Number(
            row.Position ||
              row.position ||
              index + 1
          );

        if (!title || !year) {
          skippedMissingIdentity +=
            1;

          logImportEvent(
            sessionId,
            "LIST_ITEM_SKIPPED",
            {
              rowNumber:
                index + 2,

              reason:
                "missing-title-or-year",

              title,
              year,
            }
          );

          continue;
        }

        preparedRows.push({
          ...row,

          Name: title,
          Year: year,

          Position:
            Number.isFinite(
              position
            )
              ? position
              : index + 1,

          importRowNumber:
            index + 2,
        });
      }

      preparedRows.sort(
        (left, right) =>
          Number(
            left.Position
          ) -
          Number(
            right.Position
          )
      );

      /*
       * Resolve each title/year only once, while retaining
       * the original Letterboxd order in preparedRows.
       */
      const uniqueRows =
        new Map();

      for (
        const row
        of preparedRows
      ) {
        const key =
          `${normalizeTitle(
            row.Name
          )}-${row.Year}`;

        if (
          !uniqueRows.has(key)
        ) {
          uniqueRows.set(
            key,
            row
          );
        }
      }

      const matches =
        await resolveMovieMatches(
          [
            ...uniqueRows.values(),
          ]
        );

      const movieByInputKey =
        new Map();

      const movieUpserts = [];

      for (
        const match
        of matches
      ) {
        const key =
          `${normalizeTitle(
            match.title
          )}-${match.year}`;

        movieByInputKey.set(
          key,
          match.movieData
        );

        movieUpserts.push(
          createMovieUpsert(
            match.movieData
          )
        );

        logImportEvent(
          sessionId,
          "LIST_ITEM_TMDB_MATCHED",
          {
            title:
              match.title,

            year:
              match.year,

            tmdbId:
              Number(
                match.movieData.id
              ),
          }
        );
      }

      const movies = [];
      const unmatched = [];
      const seenMovieIds =
        new Set();

      for (
        const row
        of preparedRows
      ) {
        const key =
          `${normalizeTitle(
            row.Name
          )}-${row.Year}`;

        const movieData =
          movieByInputKey.get(
            key
          );

        if (!movieData) {
          const item = {
            rowNumber:
              row.importRowNumber,

            position:
              row.Position,

            title:
              row.Name,

            year:
              row.Year,

            reason:
              "tmdb-match-not-found",
          };

          unmatched.push(item);

          logImportEvent(
            sessionId,
            "LIST_ITEM_TMDB_UNMATCHED",
            item
          );

          continue;
        }

        const movieId =
          String(
            Number(
              movieData.id
            )
          );

        if (
          seenMovieIds.has(
            movieId
          )
        ) {
          logImportEvent(
            sessionId,
            "LIST_ITEM_DUPLICATE_SKIPPED",
            {
              position:
                row.Position,

              title:
                row.Name,

              year:
                row.Year,

              tmdbId:
                movieId,
            }
          );

          continue;
        }

        seenMovieIds.add(
          movieId
        );

        movies.push({
          id:
            movieId,

          title:
            movieData.title ||
            row.Name,

          titleAr: "",

          originalTitle:
            movieData
              .original_title ||
            "",

          poster:
            movieData
              .poster_path ||
            "",

          backdrop:
            movieData
              .backdrop_path ||
            "",

          releaseDate:
            movieData
              .release_date ||
            "",

          addedAt:
            new Date(),
        });
      }

      if (!movies.length) {
        logImportEvent(
          sessionId,
          "LIST_IMPORT_REJECTED",
          {
            reason:
              "no-movies-matched",

            title:
              parsed.title,

            rows:
              preparedRows.length,
          }
        );

        return res
          .status(422)
          .json({
            message:
              "None of the films in this list could be matched.",

            sessionId,

            title:
              parsed.title,

            processed:
              preparedRows.length,

            unmatched:
              unmatched.length,

            unmatchedRows:
              unmatched.slice(
                0,
                50
              ),
          });
      }

      const existingList =
        await List.findOne({
          user:
            req.user._id,

          source:
            "scene_import",

          externalImportId:
            parsed.externalImportId,
        });

      const listPayload = {
        user:
          req.user._id,

        title:
          parsed.title,

        description:
          parsed.description,

        coverImage:
          movies[0]?.poster ||
          "",

        mediaType:
          "movies",

        isPrivate:
          false,

        isRanked:
          preparedRows.some(
            (row) =>
              Number.isFinite(
                Number(
                  row.Position
                )
              )
          ),

        movies,

        shows: [],

        source:
          "scene_import",

        importJob:
          null,

        externalImportId:
          parsed.externalImportId,
      };

      let list;
      let created = 0;
      let updated = 0;

      if (existingList) {
        existingList.title =
          listPayload.title;

        existingList.description =
          listPayload.description;

        existingList.coverImage =
          listPayload.coverImage;

        existingList.mediaType =
          "movies";

        existingList.isRanked =
          listPayload.isRanked;

        existingList.movies =
          listPayload.movies;

        existingList.shows = [];

        await existingList.save();

        list =
          existingList;

        updated = 1;

        logImportEvent(
          sessionId,
          "LETTERBOXD_LIST_UPDATED",
          {
            listId:
              String(list._id),

            title:
              list.title,

            externalImportId:
              list.externalImportId,

            itemCount:
              list.movies.length,
          }
        );
      } else {
        list =
          await List.create(
            listPayload
          );

        created = 1;

        logImportEvent(
          sessionId,
          "LETTERBOXD_LIST_CREATED",
          {
            listId:
              String(list._id),

            title:
              list.title,

            externalImportId:
              list.externalImportId,

            itemCount:
              list.movies.length,
          }
        );
      }

      if (movieUpserts.length) {
        try {
          await Movie.bulkWrite(
            movieUpserts,
            {
              ordered: false,
            }
          );
        } catch (bulkError) {
          logImportEvent(
            sessionId,
            "MOVIE_CACHE_UPSERT_PARTIAL_FAILURE",
            {
              reason:
                bulkError.message,
            }
          );
        }
      }

      const summary = {
        fileKind:
          "list",

        listId:
          String(list._id),

        title:
          list.title,

        externalImportId:
          list.externalImportId,

        created,
        updated,

        processed:
          parsed.rows.length,

        prepared:
          preparedRows.length,

        matched:
          movies.length,

        unmatched:
          unmatched.length,

        skippedMissingIdentity,

        isRanked:
          Boolean(
            list.isRanked
          ),

        itemCount:
          list.movies.length,

        durationMs:
          Date.now() -
          startedAt,

        truncated:
          Boolean(
            parsed.truncated
          ),
      };

      logImportEvent(
        sessionId,
        "IMPORT_SESSION_COMPLETE",
        summary
      );

      return res
        .status(
          created
            ? 201
            : 200
        )
        .json({
          sessionId,

          message:
            created
              ? `Created “${list.title}” with ${list.movies.length} films.`
              : `Updated “${list.title}” with ${list.movies.length} films.`,

          ...summary,

          unmatchedRows:
            unmatched.slice(
              0,
              50
            ),
        });
    } catch (error) {
      logImportEvent(
        sessionId,
        "IMPORT_SESSION_FAILED",
        {
          reason:
            error?.message ||
            String(error),

          stack:
            error?.stack ||
            "",

          durationMs:
            Date.now() -
            startedAt,
        }
      );

      console.error(
        "❌ Letterboxd list import failed:",
        error
      );

      return res
        .status(500)
        .json({
          message:
            "Server error during list import.",

          sessionId,
        });
    }
  }
);

// ============================================================
// LETTERBOXD WATCHED-HISTORY IMPORT
// ============================================================

// POST /api/import/watched
router.post(
  "/watched",
  protect,
  upload.single("file"),
  async (req, res) => {
    const sessionId =
      createImportSessionId(
        "watched",
        req.user?._id
      );

    const startedAt =
      Date.now();

    try {
      logImportEvent(
        sessionId,
        "IMPORT_SESSION_START",
        {
          type: "watched",

          userId:
            String(
              req.user?._id ||
              ""
            ),

          originalFileName:
            req.file?.originalname ||
            "",

          mimeType:
            req.file?.mimetype ||
            "",

          sizeBytes:
            Number(
              req.file?.size ||
              0
            ),
        }
      );

      const parsed =
        parseCsvFile(req.file);

      if (parsed.error) {
        logImportEvent(
          sessionId,
          "CSV_PARSE_FAILED",
          {
            reason:
              parsed.error,
          }
        );

        return res
          .status(400)
          .json({
            message:
              parsed.error,

            sessionId,
          });
      }

      const userExists =
        await User.exists({
          _id: req.user._id,
        });

      if (!userExists) {
        return res
          .status(404)
          .json({
            message:
              "User not found",

            sessionId,
          });
      }

      logImportEvent(
        sessionId,
        "CSV_PARSED",
        {
          rows:
            parsed.rows.length,

          headers:
            Object.keys(
              parsed.rows[0] ||
              {}
            ),

          truncated:
            Boolean(
              parsed.truncated
            ),
        }
      );

      const uniqueRows =
        new Map();

      let skippedMissingIdentity =
        0;

      for (
        let index = 0;
        index <
        parsed.rows.length;
        index += 1
      ) {
        const row =
          parsed.rows[index];

        const title =
          cleanString(
            row.Name ||
              row.Title ||
              row.name ||
              row.title,
            500
          );

        const year =
          parseYear(
            row.Year ||
              row.year
          );

        if (!title || !year) {
          skippedMissingIdentity +=
            1;

          logImportEvent(
            sessionId,
            "ROW_SKIPPED",
            {
              rowNumber:
                index + 2,

              reason:
                "missing-title-or-year",

              title,
              year,
            }
          );

          continue;
        }

        const key =
          `${normalizeTitle(
            title
          )}-${year}`;

        if (
          uniqueRows.has(key)
        ) {
          continue;
        }

        uniqueRows.set(key, {
          ...row,

          Name: title,
          Year: year,

          /*
           * watched.csv Date represents when the film
           * was added to Letterboxd's watched history,
           * not necessarily the actual viewing date.
           *
           * Preserve it only as a fallback date for a
           * movie that has no diary/log entry at all.
           */
          importedDate:
            parseWatchedDate(
              row.Date ||
                row.date
            ),

          importRowNumber:
            index + 2,
        });
      }

      logImportEvent(
        sessionId,
        "ROWS_PREPARED",
        {
          inputRows:
            parsed.rows.length,

          uniqueMovies:
            uniqueRows.size,

          skippedMissingIdentity,
        }
      );

      const matches =
        await resolveMovieMatches(
          [
            ...uniqueRows.values(),
          ]
        );

      const matchedKeys =
        new Set(
          matches.map(
            (match) =>
              `${normalizeTitle(
                match.title
              )}-${match.year}`
          )
        );

      const unmatched = [];

      for (
        const row
        of uniqueRows.values()
      ) {
        const key =
          `${normalizeTitle(
            row.Name
          )}-${row.Year}`;

        if (
          matchedKeys.has(key)
        ) {
          continue;
        }

        const item = {
          rowNumber:
            row.importRowNumber,

          title:
            row.Name,

          year:
            row.Year,

          reason:
            "tmdb-match-not-found",
        };

        unmatched.push(item);

        logImportEvent(
          sessionId,
          "TMDB_MATCH_FAILURE",
          item
        );
      }

      const movieIds =
        matches.map(
          (match) =>
            Number(
              match.movieData.id
            )
        );

      const existingLogs =
        await Log.find({
          user:
            req.user._id,

          tmdbId: {
            $in: movieIds,
          },
        })
          .select(
            "_id tmdbId watchedAt createdAt"
          )
          .lean();

      const existingMovieIds =
        new Set(
          existingLogs.map(
            (log) =>
              Number(
                log.tmdbId
              )
          )
        );

      let imported = 0;
      let duplicates = 0;
      let failed = 0;

      const failures = [];
      const logsToInsert = [];
      const movieUpserts = [];

      for (
        const match
        of matches
      ) {
        const movieId =
          Number(
            match.movieData.id
          );

        if (
          existingMovieIds.has(
            movieId
          )
        ) {
          duplicates += 1;

          logImportEvent(
            sessionId,
            "WATCHED_MOVIE_ALREADY_LOGGED",
            {
              rowNumber:
                match.row
                  .importRowNumber,

              title:
                match.title,

              year:
                match.year,

              tmdbId:
                movieId,

              reason:
                "scene-log-already-exists",
            }
          );

          continue;
        }

        existingMovieIds.add(
          movieId
        );

        logsToInsert.push({
          user:
            req.user._id,

          tmdbId:
            movieId,

          title:
            match.movieData
              .title ||
            match.title,

          poster:
            match.movieData
              .poster_path ||
            "",

          backdrop:
            match.movieData
              .backdrop_path ||
            "",

          rating: null,

          watchedAt:
            match.row
              .importedDate ||
            new Date(),

          review: "",

          rewatch: false,
          rewatchCount: 0,

          importedFrom:
            "letterboxd",
        });

        movieUpserts.push(
          createMovieUpsert(
            match.movieData
          )
        );

        logImportEvent(
          sessionId,
          "WATCHED_LOG_PREPARED",
          {
            rowNumber:
              match.row
                .importRowNumber,

            title:
              match.title,

            year:
              match.year,

            tmdbId:
              movieId,

            watchedAt:
              match.row
                .importedDate,
          }
        );
      }

      if (logsToInsert.length) {
        try {
          const inserted =
            await Log.insertMany(
              logsToInsert,
              {
                ordered: false,
              }
            );

          imported =
            inserted.length;

          for (
            const log
            of inserted
          ) {
            logImportEvent(
              sessionId,
              "WATCHED_LOG_CREATED",
              {
                logId:
                  String(log._id),

                tmdbId:
                  Number(
                    log.tmdbId
                  ),

                title:
                  log.title,

                watchedAt:
                  log.watchedAt,
              }
            );
          }
        } catch (insertError) {
          if (
            Array.isArray(
              insertError
                ?.insertedDocs
            )
          ) {
            imported =
              insertError
                .insertedDocs
                .length;
          }

          failed =
            Math.max(
              0,
              logsToInsert.length -
                imported
            );

          failures.push({
            reason:
              insertError.message,
          });

          logImportEvent(
            sessionId,
            "WATCHED_BULK_INSERT_PARTIAL_FAILURE",
            {
              prepared:
                logsToInsert.length,

              imported,

              failed,

              reason:
                insertError.message,
            }
          );
        }
      }

      if (movieUpserts.length) {
        try {
          await Movie.bulkWrite(
            movieUpserts,
            {
              ordered: false,
            }
          );
        } catch (bulkError) {
          logImportEvent(
            sessionId,
            "MOVIE_CACHE_UPSERT_PARTIAL_FAILURE",
            {
              reason:
                bulkError.message,
            }
          );
        }
      }

      const totalLogs =
        await synchronizeTotalLogs(
          req.user._id
        );

      const summary = {
        fileKind:
          "watched",

        inputRows:
          parsed.rows.length,

        uniqueMovies:
          uniqueRows.size,

        matched:
          matches.length,

        unmatched:
          unmatched.length,

        imported,
        duplicates,
        failed,

        skippedMissingIdentity,

        totalLogs,

        durationMs:
          Date.now() -
          startedAt,

        truncated:
          Boolean(
            parsed.truncated
          ),
      };

      logImportEvent(
        sessionId,
        "IMPORT_SESSION_COMPLETE",
        summary
      );

      return res
        .status(
          imported
            ? 201
            : 200
        )
        .json({
          sessionId,

          message:
            `Imported ${imported} missing watched films.`,

          ...summary,

          unmatchedRows:
            unmatched.slice(
              0,
              50
            ),

          failures:
            failures.slice(
              0,
              50
            ),
        });
    } catch (error) {
      logImportEvent(
        sessionId,
        "IMPORT_SESSION_FAILED",
        {
          reason:
            error?.message ||
            String(error),

          stack:
            error?.stack ||
            "",

          durationMs:
            Date.now() -
            startedAt,
        }
      );

      console.error(
        "❌ Watched import failed:",
        error
      );

      return res
        .status(500)
        .json({
          message:
            "Server error during watched-history import.",

          sessionId,
        });
    }
  }
);

// ============================================================
// LETTERBOXD LOG IMPORT
// ============================================================

// POST /api/import/logs
router.post(
  "/logs",
  protect,
  upload.single("file"),
  async (req, res) => {
    const sessionId =
      createImportSessionId(
        "logs",
        req.user?._id
      );

    const startedAt =
      Date.now();

    try {
      logImportEvent(
        sessionId,
        "IMPORT_SESSION_START",
        {
          type: "logs",

          userId:
            String(
              req.user?._id ||
              ""
            ),

          originalFileName:
            req.file
              ?.originalname ||
            "",

          mimeType:
            req.file?.mimetype ||
            "",

          sizeBytes:
            Number(
              req.file?.size ||
              0
            ),
        }
      );

      const parsed =
        parseCsvFile(req.file);

      if (parsed.error) {
        logImportEvent(
          sessionId,
          "CSV_PARSE_FAILED",
          {
            reason:
              parsed.error,
          }
        );

        return res
          .status(400)
          .json({
            message:
              parsed.error,

            sessionId,
          });
      }

      const fileKind =
        getImportFileKind(
          parsed.rows,
          req.file
            ?.originalname
        );

      logImportEvent(
        sessionId,
        "CSV_PARSED",
        {
          rows:
            parsed.rows.length,

          fileKind,

          headers:
            Object.keys(
              parsed.rows[0] ||
              {}
            ),

          truncated:
            Boolean(
              parsed.truncated
            ),
        }
      );

      if (
        ![
          "diary",
          "ratings",
        ].includes(fileKind)
      ) {
        logImportEvent(
          sessionId,
          "FILE_TYPE_REJECTED",
          {
            reason:
              "unsupported-log-csv",

            originalFileName:
              req.file
                ?.originalname ||
              "",
          }
        );

        return res
          .status(400)
          .json({
            message:
              "This file is not a supported diary or ratings CSV.",

            sessionId,
          });
      }

      const userExists =
        await User.exists({
          _id: req.user._id,
        });

      if (!userExists) {
        return res
          .status(404)
          .json({
            message:
              "User not found",

            sessionId,
          });
      }

      const preparedRows = [];

      let skippedMissingIdentity =
        0;

      for (
        let index = 0;
        index <
        parsed.rows.length;
        index += 1
      ) {
        const row =
          parsed.rows[index];

        const title =
          cleanString(
            row.Name ||
              row.Title ||
              row.name ||
              row.title,
            500
          );

        const year =
          parseYear(
            row.Year ||
              row.year
          );

        if (!title || !year) {
          skippedMissingIdentity +=
            1;

          logImportEvent(
            sessionId,
            "ROW_SKIPPED",
            {
              rowNumber:
                index + 2,

              reason:
                "missing-title-or-year",

              title,
              year,
            }
          );

          continue;
        }

        const watchedAt =
          getLetterboxdWatchedDate(
            row,
            fileKind
          );

        preparedRows.push({
          ...row,

          Name: title,
          Year: year,

          Rating:
            parseRating(
              row.Rating ||
                row.rating
            ),

          watchedAt,

          rewatch:
            parseBoolean(
              row.Rewatch ||
                row.rewatch
            ),

          importRowNumber:
            index + 2,
        });
      }

      logImportEvent(
        sessionId,
        "ROWS_PREPARED",
        {
          fileKind,

          inputRows:
            parsed.rows.length,

          preparedRows:
            preparedRows.length,

          skippedMissingIdentity,
        }
      );

      /*
       * resolveMovieMatches normally removes duplicate
       * title/year rows. Diary files need every occurrence
       * preserved, so resolve each unique movie once and
       * then map that result back onto every diary row.
       */
      const uniqueMovieRows =
        new Map();

      for (
        const row
        of preparedRows
      ) {
        const key =
          `${normalizeTitle(
            row.Name
          )}-${row.Year}`;

        if (
          !uniqueMovieRows.has(key)
        ) {
          uniqueMovieRows.set(
            key,
            row
          );
        }
      }

      const uniqueMatches =
        await resolveMovieMatches(
          [
            ...uniqueMovieRows
              .values(),
          ]
        );

      const matchByInputKey =
        new Map();

      for (
        const match
        of uniqueMatches
      ) {
        const key =
          `${normalizeTitle(
            match.title
          )}-${match.year}`;

        matchByInputKey.set(
          key,
          match.movieData
        );

        logImportEvent(
          sessionId,
          "TMDB_MATCH_SUCCESS",
          {
            title:
              match.title,

            year:
              match.year,

            tmdbId:
              Number(
                match.movieData.id
              ),
          }
        );
      }

      const matchedRows = [];
      const unmatched = [];

      for (
        const row
        of preparedRows
      ) {
        const key =
          `${normalizeTitle(
            row.Name
          )}-${row.Year}`;

        const movieData =
          matchByInputKey.get(
            key
          );

        if (!movieData) {
          const item = {
            rowNumber:
              row.importRowNumber,

            title:
              row.Name,

            year:
              row.Year,

            reason:
              "tmdb-match-not-found",
          };

          unmatched.push(item);

          logImportEvent(
            sessionId,
            "TMDB_MATCH_FAILURE",
            item
          );

          continue;
        }

        matchedRows.push({
          row,
          movieData,
        });
      }

      logImportEvent(
        sessionId,
        "TMDB_MATCH_PHASE_COMPLETE",
        {
          uniqueMoviesAttempted:
            uniqueMovieRows.size,

          uniqueMoviesMatched:
            uniqueMatches.length,

          matchedRows:
            matchedRows.length,

          unmatchedRows:
            unmatched.length,
        }
      );

      const movieIds =
        [
          ...new Set(
            matchedRows.map(
              ({ movieData }) =>
                Number(
                  movieData.id
                )
            )
          ),
        ];

      const existingLogs =
        await Log.find({
          user:
            req.user._id,

          tmdbId: {
            $in:
              movieIds,
          },
        })
          .sort({
            watchedAt: 1,
            createdAt: 1,
          });

      const logsByMovie =
        new Map();

      for (
        const existingLog
        of existingLogs
      ) {
        const movieId =
          Number(
            existingLog.tmdbId
          );

        if (
          !logsByMovie.has(
            movieId
          )
        ) {
          logsByMovie.set(
            movieId,
            []
          );
        }

        logsByMovie
          .get(movieId)
          .push(existingLog);
      }

      let imported = 0;
      let updated = 0;
      let duplicates = 0;
      let failed = 0;
      let rewatchesImported = 0;

      const failures = [];
      const movieUpserts = [];

      /*
       * Diary rows must be chronological so the first
       * known viewing is original and later ones become
       * rewatches.
       */
      matchedRows.sort(
        (left, right) => {
          const leftTime =
            left.row.watchedAt
              ?.getTime?.() ||
            0;

          const rightTime =
            right.row.watchedAt
              ?.getTime?.() ||
            0;

          return (
            leftTime -
            rightTime
          );
        }
      );

      if (
        fileKind === "diary"
      ) {
        for (
          const {
            row,
            movieData,
          } of matchedRows
        ) {
          const movieId =
            Number(
              movieData.id
            );

          const watchedAt =
            row.watchedAt ||
            new Date();

          const dayStart =
            startOfUtcDay(
              watchedAt
            );

          const dayEnd =
            addUtcDays(
              dayStart,
              1
            );

          const movieLogs =
            logsByMovie.get(
              movieId
            ) || [];

          const sameDayLog =
            movieLogs.find(
              (log) => {
                const timestamp =
                  new Date(
                    log.watchedAt
                  ).getTime();

                return (
                  timestamp >=
                    dayStart.getTime() &&
                  timestamp <
                    dayEnd.getTime()
                );
              }
            );

          if (sameDayLog) {
            let changed = false;

            if (
              Number(row.Rating) >
                0 &&
              Number(
                sameDayLog.rating ||
                0
              ) !==
                Number(
                  row.Rating
                )
            ) {
              sameDayLog.rating =
                Number(
                  row.Rating
                );

              changed = true;
            }

            if (
              row.rewatch &&
              !sameDayLog.rewatch
            ) {
              sameDayLog.rewatch =
                true;

              if (
                !Number(
                  sameDayLog
                    .rewatchCount
                )
              ) {
                sameDayLog.rewatchCount =
                  1;
              }

              changed = true;
            }

            if (changed) {
              sameDayLog
                .importedFrom =
                "letterboxd";

              await sameDayLog.save();

              updated += 1;

              logImportEvent(
                sessionId,
                "DIARY_LOG_UPDATED",
                {
                  rowNumber:
                    row.importRowNumber,

                  title:
                    row.Name,

                  year:
                    row.Year,

                  tmdbId:
                    movieId,

                  watchedAt,

                  logId:
                    String(
                      sameDayLog._id
                    ),
                }
              );
            } else {
              duplicates += 1;

              logImportEvent(
                sessionId,
                "DIARY_LOG_DUPLICATE",
                {
                  rowNumber:
                    row.importRowNumber,

                  title:
                    row.Name,

                  year:
                    row.Year,

                  tmdbId:
                    movieId,

                  watchedAt,

                  logId:
                    String(
                      sameDayLog._id
                    ),
                }
              );
            }

            continue;
          }

          const hasEarlierViewing =
            movieLogs.some(
              (log) =>
                new Date(
                  log.watchedAt
                ).getTime() <
                watchedAt.getTime()
            );

          const isRewatch =
            Boolean(
              row.rewatch ||
              hasEarlierViewing ||
              movieLogs.length > 0
            );

          const priorRewatchCount =
            movieLogs.filter(
              (log) =>
                Boolean(
                  log.rewatch
                )
            ).length;

          const rewatchCount =
            isRewatch
              ? Math.max(
                  1,
                  priorRewatchCount +
                    1
                )
              : 0;

          try {
            const createdLog =
              await Log.create({
                user:
                  req.user._id,

                tmdbId:
                  movieId,

                title:
                  movieData.title ||
                  row.Name,

                poster:
                  movieData
                    .poster_path ||
                  "",

                backdrop:
                  movieData
                    .backdrop_path ||
                  "",

                rating:
                  Number(row.Rating) >
                    0
                    ? Number(
                        row.Rating
                      )
                    : null,

                watchedAt,

                review: "",

                rewatch:
                  isRewatch,

                rewatchCount,

                importedFrom:
                  "letterboxd",
              });

            imported += 1;

            if (isRewatch) {
              rewatchesImported +=
                1;
            }

            if (
              !logsByMovie.has(
                movieId
              )
            ) {
              logsByMovie.set(
                movieId,
                []
              );
            }

            logsByMovie
              .get(movieId)
              .push(createdLog);

            logImportEvent(
              sessionId,
              isRewatch
                ? "REWATCH_LOG_CREATED"
                : "DIARY_LOG_CREATED",
              {
                rowNumber:
                  row.importRowNumber,

                title:
                  row.Name,

                year:
                  row.Year,

                tmdbId:
                  movieId,

                watchedAt,

                rewatch:
                  isRewatch,

                rewatchCount,

                logId:
                  String(
                    createdLog._id
                  ),
              }
            );

            movieUpserts.push(
              createMovieUpsert(
                movieData
              )
            );
          } catch (rowError) {
            failed += 1;

            const failure = {
              rowNumber:
                row.importRowNumber,

              title:
                row.Name,

              year:
                row.Year,

              tmdbId:
                movieId,

              reason:
                rowError.message,
            };

            failures.push(
              failure
            );

            logImportEvent(
              sessionId,
              "DIARY_LOG_FAILED",
              failure
            );
          }
        }
      } else {
        /*
         * ratings.csv contains one current rating per
         * movie. It must update an existing log rather
         * than create a second viewing.
         */
        for (
          const {
            row,
            movieData,
          } of matchedRows
        ) {
          const movieId =
            Number(
              movieData.id
            );

          const rating =
            Number(
              row.Rating ||
              0
            );

          const movieLogs =
            logsByMovie.get(
              movieId
            ) || [];

          const newestLog =
            [...movieLogs]
              .sort(
                (left, right) =>
                  new Date(
                    right.watchedAt
                  ).getTime() -
                  new Date(
                    left.watchedAt
                  ).getTime()
              )[0];

          try {
            if (newestLog) {
              if (
                Number(
                  newestLog.rating ||
                  0
                ) === rating
              ) {
                duplicates += 1;

                logImportEvent(
                  sessionId,
                  "RATING_DUPLICATE",
                  {
                    rowNumber:
                      row.importRowNumber,

                    title:
                      row.Name,

                    year:
                      row.Year,

                    tmdbId:
                      movieId,

                    rating,

                    logId:
                      String(
                        newestLog._id
                      ),
                  }
                );

                continue;
              }

              newestLog.rating =
                rating > 0
                  ? rating
                  : null;

              newestLog
                .importedFrom =
                "letterboxd";

              await newestLog.save();

              updated += 1;

              logImportEvent(
                sessionId,
                "RATING_UPDATED",
                {
                  rowNumber:
                    row.importRowNumber,

                  title:
                    row.Name,

                  year:
                    row.Year,

                  tmdbId:
                    movieId,

                  rating,

                  logId:
                    String(
                      newestLog._id
                    ),
                }
              );

              continue;
            }

            const createdLog =
              await Log.create({
                user:
                  req.user._id,

                tmdbId:
                  movieId,

                title:
                  movieData.title ||
                  row.Name,

                poster:
                  movieData
                    .poster_path ||
                  "",

                backdrop:
                  movieData
                    .backdrop_path ||
                  "",

                rating:
                  rating > 0
                    ? rating
                    : null,

                watchedAt:
                  row.watchedAt ||
                  new Date(),

                review: "",

                rewatch: false,
                rewatchCount: 0,

                importedFrom:
                  "letterboxd",
              });

            imported += 1;

            if (
              !logsByMovie.has(
                movieId
              )
            ) {
              logsByMovie.set(
                movieId,
                []
              );
            }

            logsByMovie
              .get(movieId)
              .push(createdLog);

            movieUpserts.push(
              createMovieUpsert(
                movieData
              )
            );

            logImportEvent(
              sessionId,
              "RATING_LOG_CREATED",
              {
                rowNumber:
                  row.importRowNumber,

                title:
                  row.Name,

                year:
                  row.Year,

                tmdbId:
                  movieId,

                rating,

                logId:
                  String(
                    createdLog._id
                  ),
              }
            );
          } catch (rowError) {
            failed += 1;

            const failure = {
              rowNumber:
                row.importRowNumber,

              title:
                row.Name,

              year:
                row.Year,

              tmdbId:
                movieId,

              reason:
                rowError.message,
            };

            failures.push(
              failure
            );

            logImportEvent(
              sessionId,
              "RATING_IMPORT_FAILED",
              failure
            );
          }
        }
      }

      if (
        movieUpserts.length
      ) {
        try {
          await Movie.bulkWrite(
            movieUpserts,
            {
              ordered: false,
            }
          );
        } catch (bulkError) {
          logImportEvent(
            sessionId,
            "MOVIE_CACHE_UPSERT_PARTIAL_FAILURE",
            {
              reason:
                bulkError.message,
            }
          );
        }
      }

      const totalLogs =
        await synchronizeTotalLogs(
          req.user._id
        );

      const summary = {
        fileKind,

        inputRows:
          parsed.rows.length,

        preparedRows:
          preparedRows.length,

        uniqueMovies:
          uniqueMovieRows.size,

        matchedRows:
          matchedRows.length,

        unmatched:
          unmatched.length,

        imported,
        updated,
        duplicates,
        failed,

        rewatchesImported,

        skippedMissingIdentity,

        totalLogs,

        durationMs:
          Date.now() -
          startedAt,

        truncated:
          Boolean(
            parsed.truncated
          ),
      };

      logImportEvent(
        sessionId,
        "IMPORT_SESSION_COMPLETE",
        summary
      );

      return res
        .status(
          imported || updated
            ? 201
            : 200
        )
        .json({
          sessionId,

          message:
            fileKind === "diary"
              ? `Imported ${imported} diary logs, including ${rewatchesImported} rewatches.`
              : `Imported ${imported} rating logs and updated ${updated} existing ratings.`,

          ...summary,

          unmatchedRows:
            unmatched.slice(
              0,
              50
            ),

          failures:
            failures.slice(
              0,
              50
            ),
        });
    } catch (error) {
      logImportEvent(
        sessionId,
        "IMPORT_SESSION_FAILED",
        {
          reason:
            error?.message ||
            String(error),

          stack:
            error?.stack ||
            "",

          durationMs:
            Date.now() -
            startedAt,
        }
      );

      console.error(
        "❌ Log import failed:",
        error
      );

      return res
        .status(500)
        .json({
          message:
            "Server error during log import.",

          sessionId,
        });
    }
  }
);


// ============================================================
// LETTERBOXD REVIEW IMPORT
// ============================================================

// POST /api/import/reviews
router.post(
  "/reviews",
  protect,
  upload.single("file"),
  async (req, res) => {
    const sessionId =
      createImportSessionId(
        "reviews",
        req.user?._id
      );

    const startedAt = Date.now();

    try {
      logImportEvent(
        sessionId,
        "IMPORT_SESSION_START",
        {
          type: "reviews",

          userId:
            String(
              req.user?._id || ""
            ),

          originalFileName:
            req.file?.originalname ||
            "",

          mimeType:
            req.file?.mimetype ||
            "",

          sizeBytes:
            Number(
              req.file?.size || 0
            ),
        }
      );

      const parsed =
        parseCsvFile(req.file);

      if (parsed.error) {
        logImportEvent(
          sessionId,
          "CSV_PARSE_FAILED",
          {
            reason:
              parsed.error,
          }
        );

        return res
          .status(400)
          .json({
            message:
              parsed.error,

            sessionId,
          });
      }

      logImportEvent(
        sessionId,
        "CSV_PARSED",
        {
          rows:
            parsed.rows.length,

          truncated:
            Boolean(
              parsed.truncated
            ),

          headers:
            Object.keys(
              parsed.rows[0] || {}
            ),
        }
      );

      const userExists =
        await User.exists({
          _id: req.user._id,
        });

      if (!userExists) {
        return res
          .status(404)
          .json({
            message:
              "User not found",

            sessionId,
          });
      }

      const preparedRows = [];

      let skippedMissingIdentity = 0;
      let skippedMissingReview = 0;

      for (
        let index = 0;
        index < parsed.rows.length;
        index += 1
      ) {
        const row =
          parsed.rows[index];

        const title =
          cleanString(
            row.Name ||
              row.Title ||
              row.name ||
              row.title,
            500
          );

        const year =
          parseYear(
            row.Year ||
              row.year
          );

        const review =
          cleanString(
            row.Review ||
              row.review ||
              row.Text ||
              row.text,
            10000
          );

        if (!title || !year) {
          skippedMissingIdentity += 1;

          logImportEvent(
            sessionId,
            "ROW_SKIPPED",
            {
              rowNumber:
                index + 2,

              reason:
                "missing-title-or-year",

              title,
              year,
            }
          );

          continue;
        }

        if (!review) {
          skippedMissingReview += 1;

          logImportEvent(
            sessionId,
            "ROW_SKIPPED",
            {
              rowNumber:
                index + 2,

              reason:
                "missing-review-text",

              title,
              year,
            }
          );

          continue;
        }

        preparedRows.push({
          ...row,

          Name: title,
          Year: year,
          Review: review,

          Rating:
            parseRating(
              row.Rating ||
                row.rating
            ),

          watchedAt:
            parseWatchedDate(
              row.WatchedDate ||
                row.Date ||
                row.date
            ),

          rewatch:
            parseBoolean(
              row.Rewatch ||
                row.rewatch
            ),

          importRowNumber:
            index + 2,
        });
      }

      logImportEvent(
        sessionId,
        "ROWS_PREPARED",
        {
          inputRows:
            parsed.rows.length,

          preparedRows:
            preparedRows.length,

          skippedMissingIdentity,
          skippedMissingReview,
        }
      );

      const matches =
        await resolveMovieMatches(
          preparedRows
        );

      logImportEvent(
        sessionId,
        "TMDB_MATCH_PHASE_COMPLETE",
        {
          attempted:
            preparedRows.length,

          matched:
            matches.length,

          unmatched:
            preparedRows.length -
            matches.length,
        }
      );

      const matchedKeys =
        new Set(
          matches.map(
            (match) =>
              `${normalizeTitle(
                match.title
              )}-${match.year}`
          )
        );

      const unmatched = [];

      for (
        const row
        of preparedRows
      ) {
        const key =
          `${normalizeTitle(
            row.Name
          )}-${row.Year}`;

        if (
          matchedKeys.has(key)
        ) {
          continue;
        }

        const item = {
          rowNumber:
            row.importRowNumber,

          title:
            row.Name,

          year:
            row.Year,

          reason:
            "tmdb-match-not-found",
        };

        unmatched.push(item);

        logImportEvent(
          sessionId,
          "TMDB_MATCH_FAILURE",
          item
        );
      }

      let created = 0;
      let updated = 0;
      let duplicates = 0;
      let failed = 0;

      const failures = [];

      for (const match of matches) {
        const movieId =
          Number(
            match.movieData.id
          );

        try {
          const movieLogs =
            await Log.find({
              user:
                req.user._id,

              tmdbId:
                movieId,
            }).sort({
              watchedAt: -1,
              createdAt: -1,
            });

          const exactDateLog =
            findLogOnUtcDay(
              movieLogs,
              match.row.watchedAt
            );

          const existingLog =
            exactDateLog ||
            sortLogsNewestFirst(
              movieLogs
            )[0] ||
            null;

          logImportEvent(
            sessionId,
            exactDateLog
              ? "REVIEW_EXACT_DIARY_MATCH"
              : existingLog
              ? "REVIEW_FALLBACK_LOG_MATCH"
              : "REVIEW_NO_EXISTING_LOG",
            {
              rowNumber:
                match.row
                  .importRowNumber,

              title:
                match.title,

              year:
                match.year,

              tmdbId:
                movieId,

              watchedAt:
                match.row.watchedAt,

              matchedLogId:
                existingLog
                  ? String(
                      existingLog._id
                    )
                  : null,
            }
          );

          const review =
            cleanString(
              match.row.Review,
              10000
            );

          if (existingLog) {
            const sameReview =
              cleanString(
                existingLog.review,
                10000
              ) === review;

            const sameRating =
              Number(
                existingLog.rating || 0
              ) ===
              Number(
                match.row.Rating || 0
              );

            if (
              sameReview &&
              sameRating
            ) {
              duplicates += 1;

              logImportEvent(
                sessionId,
                "REVIEW_DUPLICATE",
                {
                  title:
                    match.title,

                  year:
                    match.year,

                  tmdbId:
                    movieId,

                  logId:
                    String(
                      existingLog._id
                    ),
                }
              );

              continue;
            }

            existingLog.review =
              review;

            if (
              Number(
                match.row.Rating
              ) > 0
            ) {
              existingLog.rating =
                Number(
                  match.row.Rating
                );
            }

            /*
             * Preserve the diary log's date. Only a review-created
             * log needs the reviews CSV Watched Date assigned.
             */
            if (
              exactDateLog &&
              match.row.watchedAt
            ) {
              existingLog.watchedAt =
                match.row.watchedAt;
            }

            existingLog.rewatch =
              Boolean(
                existingLog.rewatch ||
                match.row.rewatch
              );

            if (
              match.row.rewatch &&
              !Number(
                existingLog
                  .rewatchCount
              )
            ) {
              existingLog.rewatchCount =
                1;
            }

            existingLog.importedFrom =
              "letterboxd";

            await existingLog.save();

            updated += 1;

            logImportEvent(
              sessionId,
              "REVIEW_ATTACHED",
              {
                title:
                  match.title,

                year:
                  match.year,

                tmdbId:
                  movieId,

                logId:
                  String(
                    existingLog._id
                  ),

                exactDateMatch:
                  Boolean(
                    exactDateLog
                  ),

                matchedWatchedAt:
                  existingLog
                    .watchedAt,
              }
            );

            continue;
          }

          const createdLog =
            await Log.create({
              user:
                req.user._id,

              tmdbId:
                movieId,

              title:
                match.movieData
                  .title ||
                match.title,

              poster:
                match.movieData
                  .poster_path ||
                "",

              backdrop:
                match.movieData
                  .backdrop_path ||
                "",

              rating:
                Number(
                  match.row.Rating ||
                  0
                ),

              watchedAt:
                match.row.watchedAt,

              review,

              rewatch:
                Boolean(
                  match.row.rewatch
                ),

              rewatchCount:
                match.row.rewatch
                  ? 1
                  : 0,

              importedFrom:
                "letterboxd",
            });

          created += 1;

          logImportEvent(
            sessionId,
            "REVIEW_LOG_CREATED",
            {
              title:
                match.title,

              year:
                match.year,

              tmdbId:
                movieId,

              logId:
                String(
                  createdLog._id
                ),
            }
          );

          try {
            await Movie.updateOne(
              {
                tmdbId:
                  movieId,
              },

              createMovieUpsert(
                match.movieData
              ).updateOne.update,

              {
                upsert: true,
              }
            );
          } catch (
            movieCacheError
          ) {
            logImportEvent(
              sessionId,
              "MOVIE_CACHE_UPSERT_FAILED",
              {
                title:
                  match.title,

                tmdbId:
                  movieId,

                reason:
                  movieCacheError
                    .message,
              }
            );
          }
        } catch (rowError) {
          failed += 1;

          const failure = {
            title:
              match.title,

            year:
              match.year,

            tmdbId:
              movieId,

            reason:
              rowError.message,
          };

          failures.push(
            failure
          );

          logImportEvent(
            sessionId,
            "REVIEW_IMPORT_FAILED",
            failure
          );
        }
      }

      const totalLogs =
        await synchronizeTotalLogs(
          req.user._id
        );

      const summary = {
        processed:
          parsed.rows.length,

        prepared:
          preparedRows.length,

        matched:
          matches.length,

        unmatched:
          unmatched.length,

        created,
        updated,
        duplicates,
        failed,

        skippedMissingIdentity,
        skippedMissingReview,

        totalLogs,

        durationMs:
          Date.now() -
          startedAt,

        truncated:
          Boolean(
            parsed.truncated
          ),
      };

      logImportEvent(
        sessionId,
        "IMPORT_SESSION_COMPLETE",
        summary
      );

      return res
        .status(
          created || updated
            ? 201
            : 200
        )
        .json({
          sessionId,

          message:
            `Imported ${created} new review logs and updated ${updated} existing logs.`,

          ...summary,

          unmatched:
            unmatched.slice(
              0,
              50
            ),

          failures:
            failures.slice(
              0,
              50
            ),
        });
    } catch (error) {
      logImportEvent(
        sessionId,
        "IMPORT_SESSION_FAILED",
        {
          reason:
            error?.message ||
            String(error),

          stack:
            error?.stack ||
            "",

          durationMs:
            Date.now() -
            startedAt,
        }
      );

      console.error(
        "❌ Review import failed:",
        error
      );

      return res
        .status(500)
        .json({
          message:
            "Server error during review import.",

          sessionId,
        });
    }
  }
);

// ============================================================
// UPLOAD ERROR HANDLER
// ============================================================

router.use(
  (error, req, res, next) => {
    if (
      error instanceof
      multer.MulterError
    ) {
      if (
        error.code ===
        "LIMIT_FILE_SIZE"
      ) {
        return res.status(413).json({
          message:
            "CSV file must be 10 MB or smaller",
        });
      }

      return res.status(400).json({
        message:
          "Only one valid CSV file may be uploaded",
      });
    }

    if (error) {
      console.error(
        "❌ Import route error:",
        error
      );

      return res.status(500).json({
        message: "Import failed",
      });
    }

    return next();
  }
);

module.exports = router;