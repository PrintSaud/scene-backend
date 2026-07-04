// flick-backend/src/routes/notification.js

const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const protect = require("../middleware/authMiddleware");
const sendNotification = require("../utils/sendNotification");
const Notification = require("../models/notification");

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}


// GET /api/notifications
// Fetch notifications belonging to the authenticated user.
router.get("/", protect, async (req, res) => {
  try {
    const requestedLimit = Number(req.query.limit);

    const limit =
      Number.isInteger(requestedLimit) &&
      requestedLimit > 0
        ? Math.min(requestedLimit, 100)
        : 100;

    const notifications = await Notification.find({
      to: req.user._id,
    })
      .sort({
        createdAt: -1,
      })
      .limit(limit)
      .populate(
        "from",
        "username avatar"
      )
      .lean();

    return res.status(200).json(
      notifications
    );
  } catch (err) {
    console.error(
      "❌ Error fetching notifications:",
      err
    );

    return res.status(500).json({
      message:
        "Failed to get notifications",
    });
  }
});


// GET /api/notifications/unread-count
// Get unread notification count for the authenticated user.
router.get(
  "/unread-count",
  protect,
  async (req, res) => {
    try {
      const unreadCount =
        await Notification.countDocuments({
          to: req.user._id,
          read: false,
        });

      return res.status(200).json({
        unreadCount,
      });
    } catch (err) {
      console.error(
        "❌ Failed to fetch unread count:",
        err
      );

      return res.status(500).json({
        message:
          "Failed to fetch unread count",
      });
    }
  }
);


// GET /api/notifications/unread/:userId
// Compatibility endpoint retained, but users may only access their own count.
router.get(
  "/unread/:userId",
  protect,
  async (req, res) => {
    try {
      const { userId } = req.params;

      if (!isValidObjectId(userId)) {
        return res.status(400).json({
          message: "Invalid user ID",
        });
      }

      if (
        String(req.user._id) !==
        String(userId)
      ) {
        return res.status(403).json({
          message: "Forbidden",
        });
      }

      const count =
        await Notification.countDocuments({
          to: req.user._id,
          read: false,
        });

      return res.status(200).json({
        count,
      });
    } catch (err) {
      console.error(
        "❌ Failed to fetch unread count:",
        err
      );

      return res.status(500).json({
        message: "Server error",
      });
    }
  }
);


// PATCH /api/notifications/read
// Mark all notifications belonging to the authenticated user as read.
router.patch(
  "/read",
  protect,
  async (req, res) => {
    try {
      const result =
        await Notification.updateMany(
          {
            to: req.user._id,
            read: false,
          },
          {
            $set: {
              read: true,
            },
          }
        );

      return res.status(200).json({
        message:
          "All notifications marked as read",
        updatedCount:
          result.modifiedCount || 0,
      });
    } catch (err) {
      console.error(
        "❌ Failed to mark notifications as read:",
        err
      );

      return res.status(500).json({
        message:
          "Failed to mark notifications as read",
      });
    }
  }
);


// PATCH /api/notifications/read-single/:id
// Mark one notification belonging to the authenticated user as read.
router.patch(
  "/read-single/:id",
  protect,
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          message:
            "Invalid notification ID",
        });
      }

      const notification =
        await Notification.findOneAndUpdate(
          {
            _id: id,
            to: req.user._id,
          },
          {
            $set: {
              read: true,
            },
          },
          {
            new: true,
          }
        )
          .populate(
            "from",
            "username avatar"
          )
          .lean();

      if (!notification) {
        return res.status(404).json({
          message:
            "Notification not found",
        });
      }

      return res.status(200).json({
        message:
          "Notification marked as read",
        notification,
      });
    } catch (err) {
      console.error(
        "❌ Failed to mark notification as read:",
        err
      );

      return res.status(500).json({
        message:
          "Failed to mark notification as read",
      });
    }
  }
);


// POST /api/notifications/test
// Development-only notification test route.
router.post(
  "/test",
  protect,
  async (req, res) => {
    try {
      if (
        process.env.NODE_ENV ===
        "production"
      ) {
        return res.status(404).json({
          message: "Route not found",
        });
      }

      const {
        type,
        toUserId,
        relatedId,
        movieId,
        listId,
        reviewId,
      } = req.body || {};

      if (!type || !toUserId) {
        return res.status(400).json({
          message:
            "type and toUserId are required",
        });
      }

      if (!isValidObjectId(toUserId)) {
        return res.status(400).json({
          message:
            "Invalid recipient ID",
        });
      }

      await sendNotification({
        type,
        fromUserId: req.user._id,
        toUserId,
        relatedId,
        movieId,
        listId,
        reviewId,
      });

      return res.status(200).json({
        message:
          "Test notification sent successfully",
      });
    } catch (err) {
      console.error(
        "❌ Failed to send test notification:",
        err
      );

      return res.status(500).json({
        message:
          "Failed to send test notification",
      });
    }
  }
);


// DELETE /api/notifications/:id
// Delete one notification belonging to the authenticated user.
router.delete(
  "/:id",
  protect,
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          message:
            "Invalid notification ID",
        });
      }

      const notification =
        await Notification.findOneAndDelete({
          _id: id,
          to: req.user._id,
        });

      if (!notification) {
        return res.status(404).json({
          message:
            "Notification not found",
        });
      }

      return res.status(200).json({
        message:
          "Notification deleted",
      });
    } catch (err) {
      console.error(
        "❌ Failed to delete notification:",
        err
      );

      return res.status(500).json({
        message:
          "Failed to delete notification",
      });
    }
  }
);



module.exports = router;