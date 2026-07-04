const express = require("express");
const multer = require("multer");
const path = require("path");
const Papa = require("papaparse");

const router = express.Router();

const Log = require("../models/log");
const Movie = require("../models/movieModel");
const User = require("../models/user");

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
    try {
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
// LETTERBOXD LOG IMPORT
// ============================================================

// POST /api/import/logs
router.post(
  "/logs",
  protect,
  upload.single("file"),
  async (req, res) => {
    try {
      const parsed = parseCsvFile(
        req.file
      );

      if (parsed.error) {
        return res.status(400).json({
          message: parsed.error,
        });
      }

      const userExists =
        await User.exists({
          _id: req.user._id,
        });

      if (!userExists) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      /*
       * Preserve the current Scene behavior:
       * one imported log per movie.
       *
       * When the CSV contains the same movie
       * more than once, retain the newest row.
       */
      const latestRows = new Map();

      for (const row of parsed.rows) {
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

        const watchedAt =
          parseWatchedDate(
            row.Date ||
              row.WatchedDate ||
              row.date
          );

        const key =
          `${normalizeTitle(title)}-${year}`;

        const existing =
          latestRows.get(key);

        if (
          !existing ||
          watchedAt.getTime() >
            existing.watchedAt.getTime()
        ) {
          latestRows.set(key, {
            ...row,
            Name: title,
            Year: year,
            watchedAt,
            Rating: parseRating(
              row.Rating ||
                row.rating
            ),
          });
        }
      }

      const matches =
        await resolveMovieMatches(
          [...latestRows.values()]
        );

      const existingLogs =
        await Log.find({
          user: req.user._id,

          tmdbId: {
            $in: matches.map(
              (match) =>
                Number(
                  match.movieData.id
                )
            ),
          },
        })
          .select("tmdbId")
          .lean();

      const existingMovieIds = new Set(
        existingLogs.map((log) =>
          Number(log.tmdbId)
        )
      );

      const seenMatchedMovieIds =
        new Set();

      const logsToInsert = [];
      const movieUpserts = [];

      let duplicates = 0;

      for (const match of matches) {
        const movieId = Number(
          match.movieData.id
        );

        if (
          existingMovieIds.has(movieId) ||
          seenMatchedMovieIds.has(movieId)
        ) {
          duplicates += 1;
          continue;
        }

        seenMatchedMovieIds.add(movieId);

        logsToInsert.push({
          user: req.user._id,

          tmdbId: movieId,

          title:
            match.movieData.title ||
            match.title,

          poster:
            match.movieData
              .poster_path ||
            "",

          backdrop:
            match.movieData
              .backdrop_path ||
            "",

          rating: parseRating(
            match.row.Rating
          ),

          watchedAt:
            match.row.watchedAt ||
            parseWatchedDate(
              match.row.Date
            ),

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
      }

      let imported = 0;

      if (logsToInsert.length) {
        const insertedLogs =
          await Log.insertMany(
            logsToInsert,
            {
              ordered: false,
            }
          );

        imported =
          insertedLogs.length;
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
          console.warn(
            "⚠️ Movie cache upsert partially failed:",
            bulkError.message
          );
        }
      }

      const totalLogs =
        await synchronizeTotalLogs(
          req.user._id
        );

      return res
        .status(imported ? 201 : 200)
        .json({
          message:
            `✅ Imported ${imported} logs.`,

          imported,
          duplicates,
          matched: matches.length,
          processed:
            latestRows.size,
          totalLogs,

          truncated:
            Boolean(parsed.truncated),
        });
    } catch (error) {
      console.error(
        "❌ Log import failed:",
        error
      );

      return res.status(500).json({
        message:
          "Server error during log import.",
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