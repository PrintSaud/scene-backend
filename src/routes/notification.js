const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const Notification = require("../models/notification");
const { io } = require("../server"); // ✅ LIVE socket instance

// Utility: format time ago
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

// 🔵 PATCH → mark ALL as read
router.patch("/read", protect, async (req, res) => {
  try {
    const user = await req.user;
    user.notifications.forEach((n) => (n.read = true));
    await user.save();
    res.json({ message: "All notifications marked as read" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 🔵 GET → unread count
router.get("/unread-count", protect, async (req, res) => {
  try {
    const user = await req.user;
    const unreadCount = user.notifications.filter((n) => !n.read).length;
    res.json({ unreadCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 🔥 POST → testing route with live emit
router.post("/test", async (req, res) => {
  try {
    const { type, from, to, message, relatedId } = req.body;

    const notif = await Notification.create({
      type,
      from,
      to,
      message,
      relatedId,
      read: false,
      createdAt: new Date(),
    });

    // 📡 EMIT to target user
    io.to(to).emit("notification", notif);

    res.json(notif);
  } catch (err) {
    console.error("❌ Failed to create test notification:", err);
    res.status(500).json({ message: "Failed to create test notification" });
  }
});

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

// DELETE /api/notifications/:id
router.delete("/:id", protect, async (req, res) => {
  try {
    await Notification.findByIdAndDelete(req.params.id);
    res.json({ message: "Notification deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete notification" });
  }
});


module.exports = router;
