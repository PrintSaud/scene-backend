const express = require('express');
const router = express.Router();
const Log = require('../models/log');
const User = require('../models/user');
const protect = require('../middleware/authMiddleware');
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() }); // temp in-memory upload


// GET /api/logs/:logId → Get single log with replies
router.get('/:logId', async (req, res) => {
  try {
    const log = await Log.findById(req.params.logId)
      .populate('user', 'username avatar')
      .populate('movie');

    if (!log) return res.status(404).json({ message: 'Log not found' });

    const replies = log.replies || [];

    res.json({
      _id: log._id,
      title: log.movie?.title || 'Untitled',
      poster: log.movie?.poster || 'https://image.tmdb.org/t/p/w500/default.jpg',
      review: log.review,
      rating: log.rating,
      likes: log.reactions?.get('❤️')?.length || 0,
      replies: await Promise.all(
        replies.map(async (r) => {
          const user = await User.findById(r.user).select('username avatar');
          return {
            _id: r._id,
            text: r.text,
            image: r.image,
            createdAt: r.createdAt,
            userId: user._id,
            username: user.username,
            avatar: user.avatar,
          };
        })
      ),
    });
  } catch (err) {
    console.error('Failed to fetch log:', err);
    res.status(500).json({ message: 'Failed to fetch log', error: err.message });
  }
});

// POST /api/logs/:id/reply → Add a reply (text/image)
router.post('/:id/reply', protect, upload.single('image'), async (req, res) => {
  const { text, externalImage } = req.body;

  try {
    const log = await Log.findById(req.params.id);
    if (!log) return res.status(404).json({ message: 'Log not found' });

    const image = req.file ? `/uploads/${req.file.filename}` : externalImage || null;

    if (!text && !image) {
      return res.status(400).json({ message: 'Reply must include text or image.' });
    }

    log.replies.push({
      user: req.user._id,
      text,
      image,
    });

    await log.save();

    if (log.user.toString() !== req.user._id.toString()) {
      const logOwner = await User.findById(log.user);
      logOwner.notifications.push({
        type: 'reply',
        message: `${req.user.username} replied to your review`,
        logId: log._id,
        fromUser: req.user._id,
      });
      await logOwner.save();
    }

    const latestReply = log.replies[log.replies.length - 1];
    const replyUser = await User.findById(latestReply.user).select('username avatar');

    res.status(201).json({
      _id: latestReply._id,
      text: latestReply.text,
      image: latestReply.image,
      createdAt: latestReply.createdAt,
      userId: replyUser._id,
      username: replyUser.username,
      avatar: replyUser.avatar,
    });
  } catch (err) {
    console.error('🔥 Failed to post reply:', err);
    res.status(500).json({ message: err.message });
  }
});

// Popular Logs
router.get('/movie/:id/popular', protect, async (req, res) => {
  try {
    const logs = await Log.find({ movieId: req.params.id, review: { $exists: true } })
      .populate('user', 'username avatar')
      .sort({ createdAt: -1 })
      .limit(10);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Friend Logs
router.get('/movie/:id/friends', protect, async (req, res) => {
  try {
    const friends = req.user.following || [];
    const logs = await Log.find({
      movieId: req.params.id,
      user: { $in: friends },
    })
      .populate('user', 'username avatar')
      .sort({ createdAt: -1 });

    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// GET /api/logs/:filterType → Logs by time filter
router.get('/:filterType', protect, async (req, res) => {
  const { filterType } = req.params;
  const friends = req.user.friends || [];
  let startDate;
  const now = new Date();

  switch (filterType) {
    case 'day':
      startDate = new Date(now.setDate(now.getDate() - 1));
      break;
    case 'week':
      startDate = new Date(now.setDate(now.getDate() - 7));
      break;
    case 'month':
      startDate = new Date(now.setMonth(now.getMonth() - 1));
      break;
    default:
      return res.status(400).json({ message: 'Invalid filter type' });
  }

  try {
    const logs = await Log.find({
      user: { $in: friends },
      createdAt: { $gte: startDate },
    })
      .populate('movie')
      .populate('user', 'username avatar')
      .sort({ createdAt: -1 });

    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/logs → Create new log
router.post('/', async (req, res) => {
  const { userId, movieId, comment, rewatch } = req.body;

  try {
    const newLog = await Log.create({
      user: userId,
      movie: movieId,
      review: comment || '',
      rewatch: rewatch || false,
    });

    res.status(201).json(newLog);
  } catch (err) {
    res.status(500).json({ error: 'Failed to log movie' });
  }
});

// POST /api/logs/full → Full-featured log (text, rating, gif, image, etc.)
router.post('/full', upload.single('image'), async (req, res) => {
  try {
    const {
      userId,
      movieId,
      review,
      rating,
      rewatch,
      gif,
      watchedAt,
      title,
      poster,
    } = req.body;

    const uploadedImage = req.file ? `/uploads/${req.file.originalname}` : "";

    const newLog = await Log.create({
      user: userId,
      movie: movieId,
      review: review || "",
      rating: parseFloat(rating) || 0,
      rewatch: rewatch === "true" || false,
      gif: gif || "",
      image: uploadedImage,
      watchedAt: watchedAt ? new Date(watchedAt) : Date.now(),
      title: title || "",
      poster: poster || "",
    });

    res.status(201).json({ message: "✅ Log saved successfully!", log: newLog });
  } catch (err) {
    console.error("❌ Failed to save full log:", err);
    res.status(500).json({ message: "Failed to save full log", error: err.message });
  }
});


// GET /api/logs/feed — Get logs from user + following
router.get('/feed/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    const ids = [user._id, ...user.following];

    const logs = await Log.find({ user: { $in: ids } })
      .populate('user', 'username avatar')
      .populate('movie')
      .sort({ createdAt: -1 });

    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch feed" });
  }
});

// PATCH (edit) log
router.patch('/:logId', protect, async (req, res) => {
  try {
    const log = await Log.findById(req.params.logId);
    if (log.user.toString() !== req.user._id.toString()) return res.status(403).json({ message: 'Unauthorized' });

    Object.assign(log, req.body);
    await log.save();
    res.json(log);
  } catch (err) {
    res.status(500).json({ message: "Failed to update log" });
  }
});

// DELETE log
router.delete('/:logId', protect, async (req, res) => {
  try {
    const log = await Log.findById(req.params.logId);
    if (log.user.toString() !== req.user._id.toString()) return res.status(403).json({ message: 'Unauthorized' });

    await log.remove();
    res.json({ message: 'Log deleted' });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete log" });
  }
});

// ✅ GET /api/logs/user/:userId — Get all logs by specific user
router.get('/user/:userId', async (req, res) => {
  try {
    const logs = await Log.find({ user: req.params.userId })
      .populate('movie')
      .populate('user', 'username avatar')
      .sort({ createdAt: -1 });

    res.json(logs);
  } catch (err) {
    console.error("❌ Failed to fetch user's logs:", err);
    res.status(500).json({ message: 'Failed to fetch user logs', error: err.message });
  }
});



module.exports = router;
