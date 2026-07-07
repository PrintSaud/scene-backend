// src/routes/notification.js

const express = require(
  "express"
);

const mongoose = require(
  "mongoose"
);

const router =
  express.Router();

const protect = require(
  "../middleware/authMiddleware"
);

const sendNotification = require(
  "../utils/sendNotification"
);

const Notification = require(
  "../models/notification"
);

// ======================================================
// Helpers
// ======================================================

function isValidObjectId(value) {
  return mongoose.Types
    .ObjectId
    .isValid(value);
}

function parseLimit(
  value,
  fallback = 100
) {
  const parsed =
    Number(value);

  if (
    !Number.isInteger(
      parsed
    ) ||
    parsed < 1
  ) {
    return fallback;
  }

  return Math.min(
    parsed,
    100
  );
}

/**
 * Notification mode behavior:
 *
 * all:
 * - Movie
 * - TV
 * - General notifications
 *
 * movies:
 * - Movie
 * - General notifications such as follows/system notices
 *
 * tv:
 * - TV
 * - General notifications such as follows/system notices
 */
function getMediaTypeFilter(
  value
) {
  const mode =
    typeof value ===
    "string"
      ? value
          .trim()
          .toLowerCase()
      : "all";

  if (
    mode === "movies" ||
    mode === "movie"
  ) {
    return {
      mode:
        "movies",

      filter: {
        $in: [
          "movie",
          "none",
        ],
      },
    };
  }

  if (mode === "tv") {
    return {
      mode:
        "tv",

      filter: {
        $in: [
          "tv",
          "none",
        ],
      },
    };
  }

  return {
    mode:
      "all",

    filter:
      null,
  };
}

function buildRecipientQuery({
  userId,
  mode,
  unreadOnly = false,
}) {
  const query = {
    to:
      userId,
  };

  const media =
    getMediaTypeFilter(
      mode
    );

  if (media.filter) {
    query.mediaType =
      media.filter;
  }

  if (unreadOnly) {
    query.read =
      false;
  }

  return {
    query,
    normalizedMode:
      media.mode,
  };
}

// ======================================================
// GET /api/notifications
//
// Supported:
// ?mode=all
// ?mode=movies
// ?mode=tv
// ?limit=50
// ?unreadOnly=true
// ======================================================

router.get(
  "/",
  protect,
  async (req, res) => {
    try {
      const limit =
        parseLimit(
          req.query.limit,
          100
        );

      const unreadOnly =
        String(
          req.query.unreadOnly ||
          ""
        ).toLowerCase() ===
        "true";

      const {
        query,
        normalizedMode,
      } =
        buildRecipientQuery({
          userId:
            req.user._id,

          mode:
            req.query.mode,

          unreadOnly,
        });

      const notifications =
        await Notification.find(
          query
        )
          .sort({
            createdAt:
              -1,
          })
          .limit(limit)
          .populate(
            "from",
            "username name avatar"
          )
          .lean({
            virtuals: true,
          });

      return res
        .status(200)
        .json({
          mode:
            normalizedMode,

          unreadOnly,

          count:
            notifications.length,

          notifications,
        });
    } catch (error) {
      console.error(
        "❌ Error fetching notifications:",
        error
      );

      return res
        .status(500)
        .json({
          message:
            "Failed to get notifications",
        });
    }
  }
);

// ======================================================
// GET /api/notifications/unread-count
//
// Supported:
// ?mode=all
// ?mode=movies
// ?mode=tv
// ======================================================

router.get(
  "/unread-count",
  protect,
  async (req, res) => {
    try {
      const {
        query,
        normalizedMode,
      } =
        buildRecipientQuery({
          userId:
            req.user._id,

          mode:
            req.query.mode,

          unreadOnly:
            true,
        });

      const unreadCount =
        await Notification.countDocuments(
          query
        );

      return res
        .status(200)
        .json({
          mode:
            normalizedMode,

          unreadCount,
        });
    } catch (error) {
      console.error(
        "❌ Failed to fetch unread count:",
        error
      );

      return res
        .status(500)
        .json({
          message:
            "Failed to fetch unread count",
        });
    }
  }
);

// ======================================================
// GET /api/notifications/unread/:userId
//
// Compatibility endpoint.
// Users may only access their own count.
//
// Also supports:
// ?mode=all
// ?mode=movies
// ?mode=tv
// ======================================================

router.get(
  "/unread/:userId",
  protect,
  async (req, res) => {
    try {
      const {
        userId,
      } = req.params;

      if (
        !isValidObjectId(
          userId
        )
      ) {
        return res
          .status(400)
          .json({
            message:
              "Invalid user ID",
          });
      }

      if (
        String(
          req.user._id
        ) !==
        String(userId)
      ) {
        return res
          .status(403)
          .json({
            message:
              "Forbidden",
          });
      }

      const {
        query,
        normalizedMode,
      } =
        buildRecipientQuery({
          userId:
            req.user._id,

          mode:
            req.query.mode,

          unreadOnly:
            true,
        });

      const count =
        await Notification.countDocuments(
          query
        );

      return res
        .status(200)
        .json({
          mode:
            normalizedMode,

          count,
        });
    } catch (error) {
      console.error(
        "❌ Failed to fetch unread count:",
        error
      );

      return res
        .status(500)
        .json({
          message:
            "Server error",
        });
    }
  }
);

// ======================================================
// PATCH /api/notifications/read
//
// Marks notifications as read.
//
// Supported:
// ?mode=all
// ?mode=movies
// ?mode=tv
// ======================================================

router.patch(
  "/read",
  protect,
  async (req, res) => {
    try {
      const {
        query,
        normalizedMode,
      } =
        buildRecipientQuery({
          userId:
            req.user._id,

          mode:
            req.query.mode,

          unreadOnly:
            true,
        });

      const now =
        new Date();

      const result =
        await Notification.updateMany(
          query,
          {
            $set: {
              read:
                true,

              readAt:
                now,
            },
          }
        );

      return res
        .status(200)
        .json({
          message:
            normalizedMode ===
            "all"
              ? "All notifications marked as read"
              : `${normalizedMode} notifications marked as read`,

          mode:
            normalizedMode,

          updatedCount:
            result.modifiedCount ||
            0,
        });
    } catch (error) {
      console.error(
        "❌ Failed to mark notifications as read:",
        error
      );

      return res
        .status(500)
        .json({
          message:
            "Failed to mark notifications as read",
        });
    }
  }
);

// ======================================================
// PATCH /api/notifications/read-single/:id
// ======================================================

router.patch(
  "/read-single/:id",
  protect,
  async (req, res) => {
    try {
      const {
        id,
      } = req.params;

      if (
        !isValidObjectId(id)
      ) {
        return res
          .status(400)
          .json({
            message:
              "Invalid notification ID",
          });
      }

      const notification =
        await Notification.findOneAndUpdate(
          {
            _id:
              id,

            to:
              req.user._id,
          },
          {
            $set: {
              read:
                true,

              readAt:
                new Date(),
            },
          },
          {
            new:
              true,

            runValidators:
              true,
          }
        )
          .populate(
            "from",
            "username name avatar"
          )
          .lean({
            virtuals: true,
          });

      if (!notification) {
        return res
          .status(404)
          .json({
            message:
              "Notification not found",
          });
      }

      return res
        .status(200)
        .json({
          message:
            "Notification marked as read",

          notification,
        });
    } catch (error) {
      console.error(
        "❌ Failed to mark notification as read:",
        error
      );

      return res
        .status(500)
        .json({
          message:
            "Failed to mark notification as read",
        });
    }
  }
);

// ======================================================
// PATCH /api/notifications/unread-single/:id
//
// Allows the frontend to restore one notification to unread.
// ======================================================

router.patch(
  "/unread-single/:id",
  protect,
  async (req, res) => {
    try {
      const {
        id,
      } = req.params;

      if (
        !isValidObjectId(id)
      ) {
        return res
          .status(400)
          .json({
            message:
              "Invalid notification ID",
          });
      }

      const notification =
        await Notification.findOneAndUpdate(
          {
            _id:
              id,

            to:
              req.user._id,
          },
          {
            $set: {
              read:
                false,

              readAt:
                null,
            },
          },
          {
            new:
              true,

            runValidators:
              true,
          }
        )
          .populate(
            "from",
            "username name avatar"
          )
          .lean({
            virtuals: true,
          });

      if (!notification) {
        return res
          .status(404)
          .json({
            message:
              "Notification not found",
          });
      }

      return res
        .status(200)
        .json({
          message:
            "Notification marked as unread",

          notification,
        });
    } catch (error) {
      console.error(
        "❌ Failed to mark notification as unread:",
        error
      );

      return res
        .status(500)
        .json({
          message:
            "Failed to mark notification as unread",
        });
    }
  }
);

// ======================================================
// POST /api/notifications/test
//
// Development-only unified notification tester.
// ======================================================

router.post(
  "/test",
  protect,
  async (req, res) => {
    try {
      if (
        process.env.NODE_ENV ===
        "production"
      ) {
        return res
          .status(404)
          .json({
            message:
              "Route not found",
          });
      }

      const {
        type,
        toUserId,
        message,

        mediaType,
        targetType,
        targetUrl,

        relatedId,
        movieId,
        movieTitle,
        moviePoster,
        movieLogId,

        listId,
        reviewId,

        showId,
        showTitle,
        showPoster,
        showBackdrop,

        seasonNumber,
        episodeNumber,
        episodeId,
        episodeTitle,
        episodeBackdrop,

        tvLogId,
        showReviewId,

        deduplicationKey,
        metadata,
      } =
        req.body || {};

      if (
        !type ||
        !toUserId
      ) {
        return res
          .status(400)
          .json({
            message:
              "type and toUserId are required",
          });
      }

      if (
        !isValidObjectId(
          toUserId
        )
      ) {
        return res
          .status(400)
          .json({
            message:
              "Invalid recipient ID",
          });
      }

      const notification =
        await sendNotification({
          type,

          fromUserId:
            req.user._id,

          toUserId,

          message,

          mediaType,
          targetType,
          targetUrl,

          relatedId,
          movieId,
          movieTitle,
          moviePoster,
          movieLogId,

          listId,
          reviewId,

          showId,
          showTitle,
          showPoster,
          showBackdrop,

          seasonNumber,
          episodeNumber,
          episodeId,
          episodeTitle,
          episodeBackdrop,

          tvLogId,
          showReviewId,

          deduplicationKey,
          metadata,
        });

      if (!notification) {
        return res
          .status(400)
          .json({
            message:
              "Notification was not created",
          });
      }

      return res
        .status(200)
        .json({
          message:
            "Test notification sent successfully",

          notification,
        });
    } catch (error) {
      console.error(
        "❌ Failed to send test notification:",
        error
      );

      return res
        .status(500)
        .json({
          message:
            "Failed to send test notification",
        });
    }
  }
);

// ======================================================
// DELETE /api/notifications/:id
// ======================================================

router.delete(
  "/:id",
  protect,
  async (req, res) => {
    try {
      const {
        id,
      } = req.params;

      if (
        !isValidObjectId(id)
      ) {
        return res
          .status(400)
          .json({
            message:
              "Invalid notification ID",
          });
      }

      const notification =
        await Notification.findOneAndDelete({
          _id:
            id,

          to:
            req.user._id,
        });

      if (!notification) {
        return res
          .status(404)
          .json({
            message:
              "Notification not found",
          });
      }

      return res
        .status(200)
        .json({
          message:
            "Notification deleted",
        });
    } catch (error) {
      console.error(
        "❌ Failed to delete notification:",
        error
      );

      return res
        .status(500)
        .json({
          message:
            "Failed to delete notification",
        });
    }
  }
);

// ======================================================
// Export
// ======================================================

module.exports =
  router;

  