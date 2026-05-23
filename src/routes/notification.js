// flick-backend/src/routes/notification.js
const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const sendNotification = require("../utils/sendNotification"); // updated path
const Notification = require("../models/notification");

// 🔵 GET → fetch all notifications for current user
router.get("/", protect, async (req, res) => {
  try {
    const notifications = await Notification.find({ to: req.user._id })
      .sort({ createdAt: -1 })
      .populate("from", "username avatar");
    res.json(notifications);
  } catch (err) {
    console.error("❌ Error fetching notifications:", err);
    res.status(500).json({ message: "Failed to get notifications" });
  }
});

// 🔵 PATCH → mark ALL as read
router.patch("/read", protect, async (req, res) => {
  try {
    await Notification.updateMany(
      { to: req.user._id, read: false },
      { $set: { read: true } }
    );
    res.json({ message: "All notifications marked as read" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 🔵 PATCH → mark SINGLE notification as read
router.patch("/read-single/:id", protect, async (req, res) => {
  try {
    const notif = await Notification.findById(req.params.id);
    if (!notif) return res.status(404).json({ message: "Notification not found" });
    if (notif.to.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Forbidden" });
    }
    notif.read = true;
    await notif.save();
    res.json({ message: "Notification marked as read" });
  } catch (err) {
    res.status(500).json({ message: "Failed to mark notification as read" });
  }
});

// 🔵 GET → unread count
router.get("/unread-count", protect, async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({
      to: req.user._id,
      read: false,
    });
    res.json({ unreadCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 🔥 POST → test route using sendNotification
router.post("/test", protect, async (req, res) => {
  try {
    const { type, toUserId, relatedId, movieId, listId, reviewId } = req.body;

    if (!type || !toUserId) {
      return res.status(400).json({ message: "type and toUserId are required" });
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

    res.json({ message: "Test notification sent successfully" });
  } catch (err) {
    console.error("❌ Failed to send test notification:", err);
    res.status(500).json({ message: err.message });
  }
});

// 🔴 DELETE → delete notification by id
router.delete("/:id", protect, async (req, res) => {
  try {
    const notif = await Notification.findById(req.params.id);
    if (!notif) return res.status(404).json({ message: "Notification not found" });
    if (notif.to.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Forbidden" });
    }
    await notif.deleteOne();
    res.json({ message: "Notification deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete notification" });
  }
});

// 🔹 GET unread count for specific user (public)
router.get("/unread/:userId", async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      to: req.params.userId,
      read: false,
    });
    res.json({ count });
  } catch (err) {
    console.error("❌ Failed to fetch unread count:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
