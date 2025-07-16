const express = require('express');
const router = express.Router();
const Log = require('../models/log');
const User = require('../models/user');
const protect = require('../middleware/authMiddleware');
const multer = require("multer");
const uploadToCloudinary = require("../utils/cloudinary");
const upload = multer({ storage: multer.memoryStorage() }); // temp in-memory upload
const axios = require("axios"); // Add this at top if not already
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";
const TMDB_API_KEY = process.env.TMDB_API_KEY; // Add this at top if not already
const CustomPoster = require('../models/customPoster');
const TMDB_BACKDROP = "https://image.tmdb.org/t/p/original";
const DEFAULT_POSTER = "/default-poster.jpg";
const DEFAULT_BACKDROP = "/default-backdrop.jpg";
const DEFAULT_AVATAR = "/default-avatar.jpg";

router.post('/:logId/like', protect, async (req, res) => {
  const log = await Log.findById(req.params.logId);
  if (!log) return res.status(404).json({ message: 'Not found' });

  const userId = req.user._id;
  const liked = log.likes?.includes(userId);

  if (liked) {
    log.likes.pull(userId);
  } else {
    log.likes.push(userId);
  }

  await log.save();
  res.json({ liked: !liked });
});

// 🔥 Add this to logs.js:
router.get('/:logId/replies', async (req, res) => {
  try {
    const log = await Log.findById(req.params.logId);
    if (!log) return res.status(404).json({ message: 'Log not found' });

    const replies = await Promise.all(
      (log.replies || []).map(async (r) => {
        let replyUser = await User.findById(r.user).select('username avatar');
        let ratingForThisMovie = null;

        if (replyUser) {
          const userLog = await Log.findOne({
            user: replyUser._id,
            movie: log.movie
          });
          if (userLog) {
            ratingForThisMovie = userLog.rating || null;
          }
        }

        return {
          _id: r._id,
          text: r.text || "",
          gif: r.gif || "",
          image: r.image || "",
          createdAt: r.createdAt,
          username: replyUser?.username || "unknown",
          avatar: replyUser?.avatar || DEFAULT_AVATAR,
          userId: replyUser?._id || null,
          likes: Array.isArray(r.likes) ? r.likes : [],
          ratingForThisMovie
        };
      })
    );

    res.json(replies);
  } catch (err) {
    console.error('🔥 Error fetching lightweight replies:', err);
    res.status(500).json({ message: "Failed to fetch replies" });
  }
});

router.get('/:logId', async (req, res) => {
  try {
    const log = await Log.findById(req.params.logId)
      .populate('user', 'username avatar');

    if (!log) return res.status(404).json({ message: 'Log not found' });

    let backdrop_path = null;
    let movieTitle = "Untitled";
    if (log.movie && TMDB_API_KEY) {
      try {
        const tmdbRes = await axios.get(`https://api.themoviedb.org/3/movie/${log.movie}?api_key=${TMDB_API_KEY}`);
        backdrop_path = tmdbRes.data.backdrop_path;
        movieTitle = tmdbRes.data.title;
      } catch (err) {
        console.warn(`⚠️ Failed to fetch TMDB details for movieId=${log.movie}: ${err.message}`);
      }
    }

    const poster = log.poster?.startsWith('http')
      ? log.poster
      : DEFAULT_POSTER;

    const backdrop = backdrop_path
      ? `${TMDB_BACKDROP}${backdrop_path}`
      : DEFAULT_BACKDROP;

      const likes = log.likes || [];


    const replies = await Promise.all(
      (log.replies || []).map(async (r) => {
        let replyUser = null;
        let ratingForThisMovie = null;

        if (r.user) {
          replyUser = await User.findById(r.user).select('username avatar');

          // 🔥 Check if replyUser logged this same movie
          const userLog = await Log.findOne({
            user: replyUser?._id,
            movie: log.movie
          });

          if (userLog) {
            ratingForThisMovie = userLog.rating || null;
          }
        }

        return {
          _id: r._id,
          text: r.text || "",
          gif: r.gif || "",
          image: r.image || "",
          createdAt: r.createdAt,
          username: replyUser?.username || "unknown",
          avatar: replyUser?.avatar || DEFAULT_AVATAR,
          userId: replyUser?._id || null,
          likes: Array.isArray(r.likes) ? r.likes : [],
          ratingForThisMovie // ✅ add this field
        };
      })
    );

    res.json({
      _id: log._id,
      user: log.user || null,
      movie: {
        id: log.movie || null,
        title: movieTitle,
        backdrop_path: backdrop_path || null,
      },
      poster,
      backdrop,
      review: log.review || "",
      rating: log.rating || 0,
      likes,
      image: log.image || null,
      gif: log.gif || null,
      replies,
      createdAt: log.createdAt
    });
  } catch (err) {
    console.error("🔥 Error in GET /api/logs/:logId:", err);
    res.status(500).json({ message: "Server error in /api/logs/:logId" });
  }
});

// POST /api/logs/:id/reply → Add a reply (text/image)
router.post('/:id/reply', protect, upload.single('image'), async (req, res) => {
  const { text, gif, externalImage } = req.body;

  try {
    const log = await Log.findById(req.params.id);
    if (!log) return res.status(404).json({ message: 'Log not found' });

    const image = req.file ? `/uploads/${req.file.filename}` : externalImage || null;

    if (!text && !image && !gif) {
      return res.status(400).json({ message: 'Reply must include text, image, or gif.' });
    }

    log.replies.push({
      user: req.user.id,
      text: text || "",
      gif: gif || "",
      image: image || "",
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
      gif: latestReply.gif,
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
router.post('/full', protect, upload.single('image'), async (req, res) => {
  try {
    const {
      movieId,
      review,
      rating,
      rewatch,
      gif,
      watchedAt,
      title,
      poster,
    } = req.body;

    const uploadedImage = req.file
      ? await uploadToCloudinary(req.file.buffer, "scene/logs")
      : "";

    const newLog = await Log.create({
      user: req.user._id, // ✅ use token user ID
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

// ✅ GET /api/logs/user/:userId — Get all logs by specific user with poster override support
router.get('/user/:userId', async (req, res) => {
  try {
    const logs = await Log.find({ user: req.params.userId })
      .populate('user', 'username avatar')
      .sort({ createdAt: -1 });

    const logsWithPosters = await Promise.all(
      logs.map(async (log) => {
        let posterUrl = null;

        // 🔎 First, check for poster override in CustomPoster collection:
        const customPoster = await CustomPoster.findOne({ movieId: log.movie });
        if (customPoster) {
          posterUrl = customPoster.posterUrl;
        } else if (log.poster) {
          posterUrl = log.poster.startsWith("http")
            ? log.poster
            : `${TMDB_IMG}${log.poster}`;
        } else {
          // Optional fallback to TMDB API (can comment this out if not needed)
          try {
            if (log.movie && TMDB_API_KEY) {
              const tmdbRes = await axios.get(`https://api.themoviedb.org/3/movie/${log.movie}?api_key=${TMDB_API_KEY}`);
              const fetchedPoster = tmdbRes.data.poster_path;
              if (fetchedPoster) {
                posterUrl = `${TMDB_IMG}${fetchedPoster}`;
              }
            }
          } catch (err) {
            console.warn(`⚠️ TMDB fallback failed for logId ${log._id}: ${err.message}`);
          }
        }

        return {
          ...log.toObject(),
          posterOverride: posterUrl // Inject `posterOverride` directly for frontend
        };
      })
    );

    res.json(logsWithPosters);
  } catch (err) {
    console.error("🔥 Server crash in /api/logs/user/:userId:", err);
    res.status(500).json({ message: 'Failed to fetch user logs', error: err.message });
  }
});


router.post('/:logId/replies/:replyId/like', protect, async (req, res) => {
  const log = await Log.findById(req.params.logId);
  if (!log) return res.status(404).json({ message: 'Not found' });

  const reply = log.replies.id(req.params.replyId);
  if (!reply) return res.status(404).json({ message: 'Reply not found' });

  const userId = req.user._id;
  const liked = reply.likes?.includes(userId);

  if (liked) {
    reply.likes.pull(userId);
  } else {
    reply.likes.push(userId);
  }

  await log.save();
  res.json({ liked: !liked });
});

// DELETE /api/logs/:logId/replies/:replyId → Delete a reply
router.delete('/:logId/replies/:replyId', protect, async (req, res) => {
  try {
    console.log(`👉 Delete reply ${req.params.replyId} on log ${req.params.logId}`);

    const log = await Log.findById(req.params.logId);
    if (!log) return res.status(404).json({ message: 'Log not found' });

    console.log('📝 All replies:', log.replies.map(r => r._id.toString()));
    console.log('📝 Incoming replyId:', req.params.replyId);

    const reply = log.replies.id(req.params.replyId);
    if (!reply) return res.status(404).json({ message: 'Reply not found' });

    if (reply.user && reply.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    reply.remove();
    await log.save();

    res.json({ message: 'Reply deleted' });
  } catch (err) {
    console.error('🔥 Error deleting reply:', err);
    res.status(500).json({ message: err.message });
  }
});






// ✅ TEMP TEST ROUTE — check user field type
router.get("/debug/logs/:id", async (req, res) => {
  const logs = await Log.find({ user: req.params.id }).limit(5);
  res.json(logs.map(log => typeof log.user));
});

router.get("/debug/recent", async (req, res) => {
  const logs = await Log.find({}).sort({ createdAt: -1 }).limit(5);
  res.json(logs.map(log => ({
    user: log.user,
    movie: log.movie,
    review: log.review,
    createdAt: log.createdAt
  })));
});

// GET /api/logs/:filterType → Logs by time filter
router.get('/filter/:filterType', protect, async (req, res) => { 
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


module.exports = router;
