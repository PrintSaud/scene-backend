// src/routes/user.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/user');
const Log = require("../models/log"); // ✅ Add this import
const { getMovieDetails } = require("../services/tmdbService"); // ✅ Ad
const protect = require("../middleware/authMiddleware");  // 🔔 REQUIRED 🔔
const CustomPoster = require("../models/customPoster");  // Ensure this is imported!
const Notification = require('../models/notification');  // 🔔 Add this line!
const multer = require("multer");
const axios = require("axios");
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const sendNotification = require("../utils/sendNotification");

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 5 * 1024 * 1024,
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
        "avatar"
      )
    );
  },
});

const {
  uploadToCloudinary,
} = require("../utils/cloudinary");

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

function isOwner(req, userId) {
  return String(req.user?._id) === String(userId);
}

function requireOwner(req, res, userId) {
  if (!isOwner(req, userId)) {
    res.status(403).json({
      error: "Not authorized to modify this account",
    });

    return false;
  }

  return true;
}

function escapeRegex(value = "") {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

// ✅ Save recent GIF
router.post("/gif/recent", protect, async (req, res) => {
  try {
    const gifUrl =
      typeof req.body?.gifUrl === "string"
        ? req.body.gifUrl.trim()
        : "";

    if (!gifUrl) {
      return res.status(400).json({
        success: false,
        error: "GIF URL is required",
      });
    }

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    const current = Array.isArray(user.recentGifs)
      ? user.recentGifs
      : [];

    user.recentGifs = [
      gifUrl,
      ...current.filter((item) => item !== gifUrl),
    ].slice(0, 20);

    await user.save();

    return res.status(200).json({
      success: true,
      recentGifs: user.recentGifs,
    });
  } catch (err) {
    console.error("❌ Save recent GIF error:", err);

    return res.status(500).json({
      success: false,
      error: "Failed to save recent GIF",
    });
  }
});

// ✅ Get recent GIFs
router.get("/:id/recent-gifs", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    res.status(200).json({ recentGifs: user.recentGifs || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔍 Search users by username
router.get('/search', async (req, res) => {
  const query =
  typeof req.query.query === "string"
    ? req.query.query.trim().slice(0, 50)
    : "";

  if (!query.trim()) return res.json([]);

  try {
    const users = await User.find({
      username: {
        $regex: escapeRegex(query),
        $options: "i",
      },
    })
      .select("username avatar _id")
      .limit(20);

    // 🧠 Prioritize exact matches first
    users.sort((a, b) => {
      const aExact = a.username.toLowerCase() === query.toLowerCase();
      const bExact = b.username.toLowerCase() === query.toLowerCase();

      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return a.username.localeCompare(b.username);
    });

    res.json(users);
  } catch (err) {
    console.error("❌ User search error:", err);
    res.status(500).json({ message: "Search failed", error: err.message });
  }
});


// get all users
router.get('/', async (req, res) => {
  try {
    const users = await User.find({}, 'username avatar following followers')
    res.status(200).json(users);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch users', error: err.message });
  }
});



router.get("/all", async (req, res) => {
  try {
    const users = await User.find({})
      .select("username avatar createdAt")
      .limit(500)
      .lean();

    return res.json(users);
  } catch (err) {
    console.error(
      "❌ Error fetching users:",
      err
    );

    return res.status(500).json({
      message: "Error fetching users",
    });
  }
});


router.post("/:userId/follow/:targetId",protect,async (req, res) => {
    try {
      const { userId, targetId } = req.params;

      if (
        !isValidObjectId(userId) ||
        !isValidObjectId(targetId)
      ) {
        return res.status(400).json({
          error: "Invalid user ID",
        });
      }

      if (!requireOwner(req, res, userId)) {
        return;
      }

      if (String(userId) === String(targetId)) {
        return res.status(400).json({
          error: "You cannot follow yourself",
        });
      }

      const [user, targetUser] = await Promise.all([
        User.findById(userId),
        User.findById(targetId),
      ]);

      if (!user || !targetUser) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      const isFollowing = user.following.some(
        (id) => String(id) === String(targetId)
      );

      if (
        !isFollowing &&
        targetUser.noNewFollowers
      ) {
        return res.status(403).json({
          error: "This user is not accepting new followers",
        });
      }

      if (isFollowing) {
        await Promise.all([
          User.updateOne(
            { _id: userId },
            {
              $pull: {
                following: targetId,
              },
            }
          ),

          User.updateOne(
            { _id: targetId },
            {
              $pull: {
                followers: userId,
              },
            }
          ),
        ]);

        return res.status(200).json({
          following: false,
          message: "Unfollowed user",
        });
      }

      await Promise.all([
        User.updateOne(
          { _id: userId },
          {
            $addToSet: {
              following: targetId,
            },
          }
        ),

        User.updateOne(
          { _id: targetId },
          {
            $addToSet: {
              followers: userId,
            },
          }
        ),
      ]);

      try {
        await sendNotification({
          type: "follow",
          fromUserId: userId,
          toUserId: targetId,
        });
      } catch (notificationError) {
        console.error(
          "❌ Follow notification failed:",
          notificationError
        );
      }

      return res.status(200).json({
        following: true,
        message: "Now following user",
      });
    } catch (err) {
      console.error(
        "❌ Failed to toggle follow:",
        err
      );

      return res.status(500).json({
        error: "Failed to toggle follow",
      });
    }
  }
);

// Save a custom poster for the authenticated user.
router.post("/:id/custom-poster",protect,async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          message: "Invalid user ID",
        });
      }

      if (!requireOwner(req, res, id)) {
        return;
      }

      const movieId =
        req.body?.movieId !== undefined &&
        req.body?.movieId !== null
          ? String(req.body.movieId).trim()
          : "";

      const newPoster =
        typeof req.body?.newPoster === "string"
          ? req.body.newPoster.trim()
          : "";

      if (!movieId || !newPoster) {
        return res.status(400).json({
          message:
            "movieId and newPoster are required",
        });
      }

      const user = await User.findById(id);

      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      if (!user.customPosters) {
        user.customPosters = new Map();
      }

      user.customPosters.set(
        movieId,
        newPoster
      );

      await user.save();

      return res.status(200).json({
        message:
          "Poster updated successfully",
      });
    } catch (err) {
      console.error(
        "❌ Custom poster update failed:",
        err
      );

      return res.status(500).json({
        message: "Something went wrong",
      });
    }
  }
);


// Update the authenticated user's profile backdrop.
router.put("/:id/backdrop",protect,async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          message: "Invalid user ID",
        });
      }

      if (!requireOwner(req, res, id)) {
        return;
      }

      const backdropPath =
        typeof req.body?.backdropPath ===
        "string"
          ? req.body.backdropPath.trim()
          : "";

      const user = await User.findById(id);

      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      // Empty string intentionally clears the backdrop.
      user.profileBackdrop = backdropPath;

      await user.save();

      return res.status(200).json({
        message:
          "Backdrop updated successfully",
        backdrop: user.profileBackdrop,
      });
    } catch (err) {
      console.error(
        "❌ Backdrop update failed:",
        err
      );

      return res.status(500).json({
        message:
          "Error updating backdrop",
      });
    }
  }
);


// Public backdrop lookup.
router.get("/:id/backdrop", async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid user ID",
      });
    }

    const user = await User.findById(
      req.params.id
    )
      .select("profileBackdrop")
      .lean();

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    return res.status(200).json({
      backdrop: user.profileBackdrop || "",
    });
  } catch (err) {
    console.error(
      "❌ Backdrop fetch failed:",
      err
    );

    return res.status(500).json({
      message: "Error fetching backdrop",
    });
  }
});


// Update the authenticated user's top movies.
router.put("/:id/top-movies",protect,async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          message: "Invalid user ID",
        });
      }

      if (!requireOwner(req, res, id)) {
        return;
      }

      const { topMovies } = req.body || {};

      if (
        !Array.isArray(topMovies) ||
        topMovies.length > 4
      ) {
        return res.status(400).json({
          message:
            "Top movies must be an array with a maximum of 4 items.",
        });
      }

      const normalizedTopMovies =
        topMovies
          .filter(
            (movie) =>
              typeof movie === "string"
          )
          .map((movie) => movie.trim())
          .filter(Boolean)
          .slice(0, 4);

      const user =
        await User.findByIdAndUpdate(
          id,
          {
            $set: {
              topMovies:
                normalizedTopMovies,
            },
          },
          {
            new: true,
            runValidators: true,
          }
        ).select("topMovies");

      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      return res.status(200).json({
        message:
          "Top movies updated successfully",
        topMovies: user.topMovies,
      });
    } catch (err) {
      console.error(
        "❌ Top movies update failed:",
        err
      );

      return res.status(500).json({
        message:
          "Error updating top movies",
      });
    }
  }
);


// Public top-movies lookup.
router.get("/:id/top-movies",async (req, res) => {
    try {
      if (
        !isValidObjectId(req.params.id)
      ) {
        return res.status(400).json({
          message: "Invalid user ID",
        });
      }

      const user = await User.findById(
        req.params.id
      )
        .select("topMovies")
        .lean();

      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      return res.status(200).json({
        topMovies: user.topMovies || [],
      });
    } catch (err) {
      console.error(
        "❌ Top movies fetch failed:",
        err
      );

      return res.status(500).json({
        message:
          "Error fetching top movies",
      });
    }
  }
);


// Add a favorite movie for the authenticated user.
router.post("/:userId/favorites/:tmdbId",protect,async (req, res) => {
    try {
      const { userId, tmdbId } =
        req.params;

      if (!isValidObjectId(userId)) {
        return res.status(400).json({
          error: "Invalid userId",
        });
      }

      if (
        !requireOwner(
          req,
          res,
          userId
        )
      ) {
        return;
      }

      const idNum = Number(tmdbId);

      if (
        !Number.isInteger(idNum) ||
        idNum <= 0
      ) {
        return res.status(400).json({
          error:
            "tmdbId must be a positive integer",
        });
      }

      const user =
        await User.findByIdAndUpdate(
          userId,
          {
            $addToSet: {
              favorites: idNum,
            },
          },
          {
            new: true,
            runValidators: false,
          }
        )
          .select("favorites")
          .lean();

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      return res.status(200).json({
        message: "Added to favorites",
        favorites:
          user.favorites || [],
      });
    } catch (err) {
      console.error(
        "❌ Favorites POST error:",
        err
      );

      return res.status(500).json({
        error: "Server error",
      });
    }
  }
);


// Remove a favorite movie for the authenticated user.
router.delete("/:userId/favorites/:tmdbId",protect,async (req, res) => {
    try {
      const { userId, tmdbId } =
        req.params;

      if (!isValidObjectId(userId)) {
        return res.status(400).json({
          error: "Invalid userId",
        });
      }

      if (
        !requireOwner(
          req,
          res,
          userId
        )
      ) {
        return;
      }

      const idNum = Number(tmdbId);

      if (
        !Number.isInteger(idNum) ||
        idNum <= 0
      ) {
        return res.status(400).json({
          error:
            "tmdbId must be a positive integer",
        });
      }

      const user =
        await User.findByIdAndUpdate(
          userId,
          {
            $pull: {
              favorites: idNum,
            },
          },
          {
            new: true,
            runValidators: false,
          }
        )
          .select("favorites")
          .lean();

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      return res.status(200).json({
        message:
          "Removed from favorites",
        favorites:
          user.favorites || [],
      });
    } catch (err) {
      console.error(
        "❌ Favorites DELETE error:",
        err
      );

      return res.status(500).json({
        error: "Server error",
      });
    }
  }
);
  
router.get("/username/:username",async (req, res) => {
    try {
      const username =
        typeof req.params.username ===
        "string"
          ? req.params.username
              .trim()
              .slice(0, 50)
          : "";

      if (!username) {
        return res.status(400).json({
          message:
            "Username is required",
        });
      }

      const user = await User.findOne({
        username: {
          $regex: `^${escapeRegex(
            username
          )}$`,
          $options: "i",
        },
      })
        .select(
          [
            "username",
            "avatar",
            "bio",
            "favoriteCharacter",
            "favoriteActor",
            "topMovies",
            "favoriteFilms",
            "profileBackdrop",
            "socials",
          ].join(" ")
        )
        .lean();

      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      return res.status(200).json(
        user
      );
    } catch (err) {
      console.error(
        "❌ Username lookup failed:",
        err
      );

      return res.status(500).json({
        message:
          "Error fetching user by username",
      });
    }
  }
);


router.get("/mutuals", protect, async (req, res) => {
  try {
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

    const mutuals = await User.find({
      _id: {
        $in: currentUser.following || [],
      },
      following: req.user._id,
    })
      .select("username avatar")
      .lean();

    return res.status(200).json(mutuals);
  } catch (err) {
    console.error(
      "❌ Failed to fetch mutual followers:",
      err
    );

    return res.status(500).json({
      message: "Server error",
    });
  }
});


// GET /api/users/:id — public profile payload
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid user ID",
      });
    }

    /*
     * Never expose private authentication or notification data
     * through a public profile endpoint.
     */
    const user = await User.findById(id)
      .select(
        [
          "-password",
          "-email",
          "-googleId",
          "-resetCode",
          "-resetCodeExpires",
          "-verificationCode",
          "-verificationCodeExpires",
          "-deviceTokens",
          "-pushSettings",
        ].join(" ")
      )
      .lean();

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const [
      customPosterDocs,
      uniqueFilms,
      followerCount,
      recentLogs,
    ] = await Promise.all([
      CustomPoster.find({
        userId: id,
      }).lean(),

      Log.distinct("movie", {
        user: id,
      }),

      User.countDocuments({
        following: id,
      }),

      Log.find({
        user: id,
      })
        .sort({
          createdAt: -1,
        })
        .limit(4)
        .select(
          "movie title poster rating rewatch createdAt review"
        )
        .lean(),
    ]);

    const customPosters = {};

    for (const document of customPosterDocs) {
      customPosters[String(document.movieId)] =
        document.posterUrl;
    }

    const favoriteFilms = Array.isArray(
      user.favoriteFilms
    )
      ? user.favoriteFilms
      : [];

    const favorites = Array.isArray(
      user.favorites
    )
      ? user.favorites
          .map(Number)
          .filter(Number.isFinite)
      : [];

    return res.status(200).json({
      ...user,

      favoriteFilms,

      /*
       * Temporary compatibility alias.
       * Some existing frontend code may still read favoriteMovies.
       */
      favoriteMovies: favoriteFilms,

      favorites,
      customPosters,
      totalLogs: uniqueFilms.length,
      followerCount,
      followingCount: Array.isArray(
        user.following
      )
        ? user.following.length
        : 0,
      recentLogs,
    });
  } catch (err) {
    console.error(
      "❌ Failed to get user profile:",
      err
    );

    return res.status(500).json({
      message: "Failed to fetch user",
    });
  }
});

// PATCH /api/users/:id — update user profile (safe merge)
// PATCH /api/users/:id — update authenticated user's profile
router.patch("/:id",protect,upload.single("avatar"),async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          error: "Invalid user ID",
        });
      }

      if (!requireOwner(req, res, id)) {
        return;
      }

      const user = await User.findById(id);

      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      const patch = {};

      /*
       * This route previously called uploadToCloudinary without
       * importing or defining it.
       */
      if (req.file) {
        if (
          typeof uploadToCloudinary !==
          "function"
        ) {
          return res.status(500).json({
            error:
              "Avatar upload service is not configured",
          });
        }

        patch.avatar =
          await uploadToCloudinary(
            req.file.buffer,
            "scene/avatars"
          );
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "name"
        )
      ) {
        patch.name =
          typeof req.body.name === "string"
            ? req.body.name.trim().slice(0, 100)
            : "";
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "bio"
        )
      ) {
        patch.bio =
          typeof req.body.bio === "string"
            ? req.body.bio.trim().slice(0, 1000)
            : "";
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "profileBackdrop"
        )
      ) {
        patch.profileBackdrop =
          typeof req.body.profileBackdrop ===
          "string"
            ? req.body.profileBackdrop.trim()
            : "";
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "favoriteFilms"
        )
      ) {
        const incomingFavorites =
          Array.isArray(
            req.body.favoriteFilms
          )
            ? req.body.favoriteFilms
            : safeJson(
                req.body.favoriteFilms,
                []
              );

        if (
          !Array.isArray(
            incomingFavorites
          )
        ) {
          return res.status(400).json({
            error:
              "favoriteFilms must be an array",
          });
        }

        if (
          incomingFavorites.length > 4
        ) {
          return res.status(400).json({
            error:
              "A maximum of four favorite films is allowed",
          });
        }

        const enrichedFavorites =
          await Promise.all(
            incomingFavorites.map(
              async (movie) => {
                const tmdbId = Number(
                  movie?.tmdbId ||
                    movie?.id ||
                    movie
                );

                if (
                  !Number.isInteger(
                    tmdbId
                  ) ||
                  tmdbId <= 0
                ) {
                  return null;
                }

                const suppliedPoster =
                  movie?.poster_path ||
                  movie?.poster ||
                  "";

                if (suppliedPoster) {
                  return {
                    tmdbId,
                    title:
                      movie?.title ||
                      movie?.original_title ||
                      "",
                    poster_path:
                      suppliedPoster,
                  };
                }

                try {
                  const { data } =
                    await axios.get(
                      `https://api.themoviedb.org/3/movie/${tmdbId}`,
                      {
                        params: {
                          api_key:
                            TMDB_API_KEY,
                          language:
                            "en-US",
                        },
                        timeout: 8000,
                      }
                    );

                  return {
                    tmdbId,
                    title:
                      movie?.title ||
                      data?.title ||
                      "",
                    poster_path:
                      data?.poster_path ||
                      "",
                  };
                } catch (error) {
                  console.warn(
                    "⚠️ TMDB favorite-film fetch failed:",
                    tmdbId,
                    error.message
                  );

                  return {
                    tmdbId,
                    title:
                      movie?.title ||
                      "",
                    poster_path: "",
                  };
                }
              }
            )
          );

        const seenMovieIds =
          new Set();

        patch.favoriteFilms =
          enrichedFavorites
            .filter(Boolean)
            .filter((movie) => {
              if (
                seenMovieIds.has(
                  movie.tmdbId
                )
              ) {
                return false;
              }

              seenMovieIds.add(
                movie.tmdbId
              );

              return true;
            })
            .slice(0, 4);
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "socials"
        )
      ) {
        const incomingSocials =
          typeof req.body.socials ===
          "string"
            ? safeJson(
                req.body.socials,
                null
              )
            : req.body.socials;

        if (
          !incomingSocials ||
          typeof incomingSocials !==
            "object" ||
          Array.isArray(
            incomingSocials
          )
        ) {
          return res.status(400).json({
            error:
              "socials must be an object",
          });
        }

        const allowedSocialFields =
          new Set([
            "X",
            "youtube",
            "instagram",
            "tiktok",
            "imdb",
            "tmdb",
            "website",
          ]);

        const sanitizedSocials = {};

        for (const [
          key,
          value,
        ] of Object.entries(
          incomingSocials
        )) {
          if (
            !allowedSocialFields.has(
              key
            )
          ) {
            continue;
          }

          sanitizedSocials[key] =
            typeof value === "string"
              ? value
                  .trim()
                  .slice(0, 500)
              : "";
        }

        patch.socials = {
          ...(user.socials?.toObject?.() ||
            user.socials ||
            {}),
          ...sanitizedSocials,
        };
      }

      Object.assign(user, patch);

      await user.save();

      return res.status(200).json({
        message: "Profile updated",
        user: {
          _id: user._id,
          name: user.name,
          username: user.username,
          bio: user.bio,
          avatar: user.avatar,
          profileBackdrop:
            user.profileBackdrop,
          favoriteFilms:
            user.favoriteFilms,
          socials: user.socials,
        },
      });
    } catch (err) {
      console.error(
        "❌ Profile update failed:",
        err
      );

      if (
        err?.name ===
        "MulterError"
      ) {
        return res.status(400).json({
          error: "Invalid avatar upload",
        });
      }

      return res.status(500).json({
        error: "Server error",
      });
    }
  }
);

function safeJson(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// routes/userRoutes.js
router.get("/:id/followers",async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          message: "Invalid user ID",
        });
      }

      const [user, followers] =
        await Promise.all([
          User.findById(id)
            .select("username")
            .lean(),

          User.find({
            following: id,
          })
            .select(
              "username avatar"
            )
            .lean(),
        ]);

      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      return res.status(200).json({
        user,
        followers,
      });
    } catch (err) {
      console.error(
        "❌ Failed to fetch followers:",
        err
      );

      return res.status(500).json({
        message:
          "Failed to fetch followers",
      });
    }
  }
);


router.get("/:id/following",async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          message: "Invalid user ID",
        });
      }

      const user = await User.findById(
        id
      )
        .select("username following")
        .populate(
          "following",
          "username avatar"
        )
        .lean();

      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      return res.status(200).json({
        user: {
          username: user.username,
        },
        following:
          user.following || [],
      });
    } catch (err) {
      console.error(
        "❌ Failed to fetch following:",
        err
      );

      return res.status(500).json({
        message:
          "Failed to fetch following",
      });
    }
  }
);


router.patch("/:id/language",protect,async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          error: "Invalid user ID",
        });
      }

      if (!requireOwner(req, res, id)) {
        return;
      }

      const language =
        typeof req.body?.language ===
        "string"
          ? req.body.language
              .trim()
              .toLowerCase()
          : "";

      if (
        !["en", "ar"].includes(
          language
        )
      ) {
        return res.status(400).json({
          error: "Invalid language",
        });
      }

      const user =
        await User.findByIdAndUpdate(
          id,
          {
            $set: {
              language,
            },
          },
          {
            new: true,
            runValidators: true,
          }
        )
          .select(
            "_id username language"
          )
          .lean();

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      return res.status(200).json({
        message: "Language updated",
        user,
      });
    } catch (err) {
      console.error(
        "❌ Update language error:",
        err
      );

      return res.status(500).json({
        error:
          "Failed to update language",
      });
    }
  }
);



// POST /api/users/:id/notify/share
// Send a movie suggestion notification.
router.post("/:id/notify/share",protect,async (req, res) => {
    try {
      const recipientId = req.params.id;
      const senderId = req.user._id;

      if (!isValidObjectId(recipientId)) {
        return res.status(400).json({
          message: "Invalid recipient ID",
        });
      }

      const movieId = Number(
        req.body?.movieId
      );

      if (
        !Number.isInteger(movieId) ||
        movieId <= 0
      ) {
        return res.status(400).json({
          message:
            "A valid movieId is required",
        });
      }

      if (
        String(recipientId) ===
        String(senderId)
      ) {
        return res.status(400).json({
          message:
            "You cannot suggest a movie to yourself",
        });
      }

      const [recipient, fromUser] =
        await Promise.all([
          User.findById(recipientId)
            .select(
              "username deviceTokens pushSettings"
            ),

          User.findById(senderId)
            .select(
              "username avatar"
            ),
        ]);

      if (!recipient) {
        return res.status(404).json({
          message: "Recipient not found",
        });
      }

      if (!fromUser) {
        return res.status(404).json({
          message: "Sender not found",
        });
      }

      const notification =
        await Notification.create({
          type: "suggest_movie",
          message:
            "suggested you check out this film!",
          from: senderId,
          to: recipientId,
          movieId,
          read: false,
        });

      const io = req.app.get("io");

      if (io) {
        io.to(
          String(recipientId)
        ).emit("notification", {
          ...notification.toObject(),

          from: {
            _id: fromUser._id,
            username:
              fromUser.username,
            avatar: fromUser.avatar,
          },
        });
      }

      return res.status(200).json({
        message: "Notification sent",
      });
    } catch (err) {
      console.error(
        "❌ Failed to send movie suggestion:",
        err
      );

      return res.status(500).json({
        message:
          "Failed to send notification",
      });
    }
  }
);

// ✅ Fast Watchlist (no TMDB calls)
router.get("/:userId/watchlist", async (req, res) => {
  const { userId } = req.params;
  const rawSort = req.query.sort || "added";
  const rawOrder = req.query.order === "asc" ? "asc" : "desc";
  const genre = req.query.genre ? Number(req.query.genre) : null;

  const ALLOWED_SORTS = new Set(["added", "release", "rating", "runtime"]);
  const sort = ALLOWED_SORTS.has(rawSort) ? rawSort : "added";
  const dir = rawOrder === "asc" ? 1 : -1;

  const toTs = (d) => (d ? new Date(d).getTime() || 0 : 0);

  try {
    const user = await User.findById(userId).lean();
    if (!user || !user.watchlist) {
      return res.status(404).json({ error: "User or watchlist not found" });
    }

    let movies = user.watchlist.filter(
      (w) => typeof w === "object" && w.tmdbId
    );

    // Hydrate any entries missing runtime, rating, release_date, or genres
    const needHydrate = movies.filter(
      (m) =>
        !Array.isArray(m.genres) ||
        m.genres.length === 0 ||
        m.runtime == null ||
        m.vote_average == null ||
        !m.release_date
    );

    if (needHydrate.length) {
      await Promise.all(
        needHydrate.map(async (m) => {
          try {
            const d = await getMovieDetails(m.tmdbId);
            m.genres = d?.genres || [];
            m.runtime = d?.runtime ?? null;
            m.vote_average = d?.vote_average ?? null;
            m.release_date = d?.release_date ?? null;

            await User.updateOne(
              { _id: userId, "watchlist.tmdbId": m.tmdbId },
              {
                $set: {
                  "watchlist.$.genres": m.genres,
                  "watchlist.$.runtime": m.runtime,
                  "watchlist.$.vote_average": m.vote_average,
                  "watchlist.$.release_date": m.release_date,
                },
              }
            );
          } catch (e) {
            // ignore per-item errors
          }
        })
      );
    }

    // Apply genre filter if requested
    if (Number.isFinite(genre) && genre > 0) {
      movies = movies.filter(
        (m) =>
          Array.isArray(m.genres) && m.genres.some((g) => g.id === genre)
      );
    }

    // Safe sort
    movies.sort((a, b) => {
      if (sort === "added") {
        return (toTs(a.addedAt) - toTs(b.addedAt)) * dir;
      }
      if (sort === "release") {
        return (toTs(a.release_date) - toTs(b.release_date)) * dir;
      }
      if (sort === "rating") {
        const av = Number.isFinite(a?.vote_average) ? a.vote_average : 0;
        const bv = Number.isFinite(b?.vote_average) ? b.vote_average : 0;
        return (av - bv) * dir;
      }
      if (sort === "runtime") {
        const ar = Number.isFinite(a?.runtime) ? a.runtime : 0;
        const br = Number.isFinite(b?.runtime) ? b.runtime : 0;
        return (ar - br) * dir;
      }
      return ((a.title || "").localeCompare(b.title || "")) * dir;
    });

    // Custom posters
    const customPosters = await CustomPoster.find({
      userId,
      movieId: { $in: movies.map((m) => String(m.tmdbId)) },
    }).lean();

    const postersMap = {};
    for (const cp of customPosters) {
      postersMap[String(cp.movieId)] = cp.posterUrl;
    }

    // Enrich missing poster_path if needed
    const enriched = await Promise.all(
      movies.map(async (m) => {
        let poster_path = m.poster_path || null;
        let title = m.title || null;
        let release_date = m.release_date || null;

        if (!poster_path) {
          try {
            const d = await getMovieDetails(m.tmdbId);
            poster_path = d?.poster_path || null;
            title = title || d?.title || null;
            release_date = release_date || d?.release_date || null;
          } catch {
            // ignore per-item fetch errors
          }
        }

        return {
          ...m,
          posterOverride: postersMap[String(m.tmdbId)] || null,
          poster_path,
          title,
          release_date,
        };
      })
    );

    res.json(enriched);
  } catch (err) {
    console.error("❌ Failed to fetch watchlist", err);
    res.status(500).json({ error: "Could not fetch watchlist" });
  }
});


// routes/userRoutes.js
router.post("/:id/remove-follower/:followerId",protect,async (req, res) => {
    try {
      const { id, followerId } =
        req.params;

      if (
        !isValidObjectId(id) ||
        !isValidObjectId(followerId)
      ) {
        return res.status(400).json({
          error: "Invalid user ID",
        });
      }

      if (!requireOwner(req, res, id)) {
        return;
      }

      if (
        String(id) ===
        String(followerId)
      ) {
        return res.status(400).json({
          error:
            "Invalid follower ID",
        });
      }

      const [user, follower] =
        await Promise.all([
          User.findByIdAndUpdate(
            id,
            {
              $pull: {
                followers: followerId,
              },
            },
            {
              new: true,
            }
          ).select("followers"),

          User.findByIdAndUpdate(
            followerId,
            {
              $pull: {
                following: id,
              },
            },
            {
              new: true,
            }
          ).select("_id"),
        ]);

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      if (!follower) {
        return res.status(404).json({
          error: "Follower not found",
        });
      }

      return res.status(200).json({
        success: true,
      });
    } catch (err) {
      console.error(
        "❌ Failed to remove follower:",
        err
      );

      return res.status(500).json({
        message: "Server error",
      });
    }
  }
);



module.exports = router;

