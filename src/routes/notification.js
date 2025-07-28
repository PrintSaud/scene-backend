const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const Notification = require("../models/notification");
const { io } = require("../server"); // ✅ LIVE socket instance

// Utility: format time ago (not used here but you can keep if needed)
const formatTimeAgo = (date) => {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  const intervals = {
    year: 31536000, month: 2592000, day: 86400,
    hour: 3600, minute: 60,
  };
  for (const [unit, value] of Object.entries(intervals)) {
    const amount = Math.floor(seconds / value);
    if (amount >= 1) return `${amount} ${unit}${amount > 1 ? "s" : ""} ago`;
  }
  return "just now";
};

// 🔵 GET → fetch all for current user
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

// 🔵 PATCH → mark ALL as read (fix: update Notification collection properly)
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

// 🔥 POST → testing route with live emit
router.post("/test", async (req, res) => {
  try {
    const { type, from, to, message, relatedId, listId, movieId } = req.body;

    const notif = await Notification.create({
      type,
      from,
      to,
      message,
      relatedId,
      listId,
      movieId,
      read: false,
      createdAt: new Date(),
    });

    io.to(to).emit("notification", notif);

    res.json(notif);
  } catch (err) {
    console.error("❌ Failed to create test notification:", err);
    res.status(500).json({ message: "Failed to create test notification" });
  }
});

// 🔴 DELETE → delete by id
router.delete("/:id", protect, async (req, res) => {
  try {
    const notif = await Notification.findById(req.params.id);
    if (!notif) return res.status(404).json({ message: "Notification not found" });
    if (notif.to.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Forbidden" });
    }
    await notif.remove();
    res.json({ message: "Notification deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete notification" });
  }
});

// GET /api/notifications/unread/:userId
router.get('/unread/:userId', async (req, res) => {
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
