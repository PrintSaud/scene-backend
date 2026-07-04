const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const protect = require("../middleware/authMiddleware");
const CustomPoster = require("../models/customPoster");

const MAX_BATCH_SIZE = 500;

const RESTRICTED_POSTERS = new Map([
  [
    11020,
    "https://image.tmdb.org/t/p/original/iAdsTUNjpHIREH4C4UNhkbVDWYi.jpg",
  ],
]);

// ============================================================
// HELPERS
// ============================================================

const isValidObjectId = (value) =>
  mongoose.Types.ObjectId.isValid(value);

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

const cleanPosterUrl = (value) => {
  if (
    typeof value !== "string"
  ) {
    return null;
  }

  const posterUrl = value
    .trim()
    .slice(0, 2000);

  if (!posterUrl) {
    return null;
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(posterUrl);
  } catch {
    return null;
  }

  if (
    parsedUrl.protocol !== "https:"
  ) {
    return null;
  }

  const allowedHosts = new Set([
    "image.tmdb.org",
    "res.cloudinary.com",
  ]);

  if (
    !allowedHosts.has(
      parsedUrl.hostname
    )
  ) {
    return null;
  }

  return parsedUrl.toString();
};

const isRestrictedPosterAllowed = (
  movieId,
  posterUrl
) => {
  const requiredPoster =
    RESTRICTED_POSTERS.get(movieId);

  if (!requiredPoster) {
    return true;
  }

  return posterUrl === requiredPoster;
};

// ============================================================
// BATCH RETRIEVAL
// ============================================================

// POST /api/posters/batch
router.post(
  "/batch",
  protect,
  async (req, res) => {
    try {
      const requestedUserId =
        req.body.userId ||
        req.user._id;

      if (
        !isValidObjectId(
          requestedUserId
        )
      ) {
        return res.status(400).json({
          message: "Invalid user ID",
        });
      }

      if (
        !Array.isArray(
          req.body.movieIds
        )
      ) {
        return res.status(400).json({
          message:
            "movieIds must be an array",
        });
      }

      const validMovieIds = [
        ...new Set(
          req.body.movieIds
            .map(parseMovieId)
            .filter(Boolean)
        ),
      ].slice(0, MAX_BATCH_SIZE);

      if (!validMovieIds.length) {
        return res.status(400).json({
          message:
            "No valid movie IDs provided",
        });
      }

      const posters =
        await CustomPoster.find({
          userId: requestedUserId,

          movieId: {
            $in: validMovieIds,
          },
        })
          .select(
            "movieId posterUrl -_id"
          )
          .lean();

      const result = {};

      for (const poster of posters) {
        result[
          String(poster.movieId)
        ] = poster.posterUrl;
      }

      return res.json(result);
    } catch (error) {
      console.error(
        "❌ Custom poster batch failed:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to fetch custom posters",
      });
    }
  }
);

// ============================================================
// USER POSTER COLLECTION
// ============================================================

// GET /api/posters/user/:userId
router.get(
  "/user/:userId",
  async (req, res) => {
    try {
      const { userId } = req.params;

      if (!isValidObjectId(userId)) {
        return res.status(400).json({
          message: "Invalid user ID",
        });
      }

      const posters =
        await CustomPoster.find({
          userId,
        })
          .select(
            "movieId posterUrl updatedAt -_id"
          )
          .sort({
            updatedAt: -1,
          })
          .lean();

      return res.json(posters);
    } catch (error) {
      console.error(
        "❌ Failed to fetch user custom posters:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to fetch custom posters",
      });
    }
  }
);

// ============================================================
// SINGLE POSTER RETRIEVAL
// ============================================================

// GET /api/posters/:movieId?userId=<userId>
router.get(
  "/:movieId",
  async (req, res) => {
    try {
      const movieId = parseMovieId(
        req.params.movieId
      );

      if (!movieId) {
        return res.status(400).json({
          message: "Invalid movie ID",
        });
      }

      const userId =
        typeof req.query.userId ===
        "string"
          ? req.query.userId.trim()
          : "";

      if (!userId) {
        return res.json({
          posterOverride: null,
        });
      }

      if (!isValidObjectId(userId)) {
        return res.status(400).json({
          message: "Invalid user ID",
        });
      }

      const poster =
        await CustomPoster.findOne({
          userId,
          movieId,
        })
          .select(
            "posterUrl updatedAt -_id"
          )
          .lean();

      return res.json({
        posterOverride:
          poster?.posterUrl || null,
      });
    } catch (error) {
      console.error(
        "❌ Failed to fetch poster override:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to fetch poster override",
      });
    }
  }
);

// ============================================================
// CREATE OR UPDATE OWN POSTER
// ============================================================

// POST /api/posters/:movieId
router.post(
  "/:movieId",
  protect,
  async (req, res) => {
    try {
      const movieId = parseMovieId(
        req.params.movieId
      );

      if (!movieId) {
        return res.status(400).json({
          message: "Invalid movie ID",
        });
      }

      const posterUrl =
        cleanPosterUrl(
          req.body.posterUrl
        );

      if (!posterUrl) {
        return res.status(400).json({
          message:
            "A valid HTTPS poster URL is required",
        });
      }

      if (
        !isRestrictedPosterAllowed(
          movieId,
          posterUrl
        )
      ) {
        return res.status(403).json({
          error:
            "Custom posters for this movie are restricted.",
        });
      }

      const updated =
        await CustomPoster.findOneAndUpdate(
          {
            userId: req.user._id,
            movieId,
          },
          {
            $set: {
              posterUrl,
              updatedAt: new Date(),
            },

            $setOnInsert: {
              userId: req.user._id,
              movieId,
            },
          },
          {
            new: true,
            upsert: true,
            runValidators: true,
            setDefaultsOnInsert: true,
          }
        );

      return res.json({
        message:
          "Poster override saved",

        poster: updated,
      });
    } catch (error) {
      if (
        error?.code === 11000
      ) {
        try {
          const updated =
            await CustomPoster.findOneAndUpdate(
              {
                userId: req.user._id,
                movieId:
                  parseMovieId(
                    req.params.movieId
                  ),
              },
              {
                $set: {
                  posterUrl:
                    cleanPosterUrl(
                      req.body.posterUrl
                    ),
                  updatedAt:
                    new Date(),
                },
              },
              {
                new: true,
              }
            );

          return res.json({
            message:
              "Poster override saved",

            poster: updated,
          });
        } catch (
          duplicateRecoveryError
        ) {
          console.error(
            "❌ Duplicate poster recovery failed:",
            duplicateRecoveryError
          );
        }
      }

      console.error(
        "❌ Failed to save poster override:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to save poster override",
      });
    }
  }
);

// ============================================================
// DELETE OWN POSTER OVERRIDE
// ============================================================

// DELETE /api/posters/:movieId
router.delete(
  "/:movieId",
  protect,
  async (req, res) => {
    try {
      const movieId = parseMovieId(
        req.params.movieId
      );

      if (!movieId) {
        return res.status(400).json({
          message: "Invalid movie ID",
        });
      }

      const deleted =
        await CustomPoster.findOneAndDelete({
          userId: req.user._id,
          movieId,
        });

      return res.json({
        deleted: Boolean(deleted),
        posterOverride: null,
        message: deleted
          ? "Poster override removed"
          : "No poster override existed",
      });
    } catch (error) {
      console.error(
        "❌ Failed to remove poster override:",
        error
      );

      return res.status(500).json({
        message:
          "Failed to remove poster override",
      });
    }
  }
);

module.exports = router;