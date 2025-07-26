const express = require('express');
const router = express.Router();
const Log = require('../models/log');
const User = require('../models/user');
const protect = require('../middleware/authMiddleware');
const multer = require("multer");
const { uploadToCloudinary } = require("../utils/cloudinary");
const upload = multer({ storage: multer.memoryStorage() }); // temp in-memory upload
const axios = require("axios"); // Add this at top if not already
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";
const TMDB_API_KEY = process.env.TMDB_API_KEY; // Add this at top if not already
const CustomPoster = require('../models/customPoster');
const TMDB_BACKDROP = "https://image.tmdb.org/t/p/original";
const DEFAULT_POSTER = "/default-poster.jpg";
const DEFAULT_BACKDROP = "/default-backdrop.jpg";
const DEFAULT_AVATAR = "/default-avatar.jpg";
const Notification = require('../models/notification');
const expressJson = express.json();  // ⭐️ add this line
router.post('/:logId/like', protect, async (req, res) => {
  try {
    const log = await Log.findById(req.params.logId).populate('user', 'username');
    if (!log) return res.status(404).json({ message: 'Not found' });

    const userId = req.user._id;
    const liked = log.likes?.includes(userId);

    if (liked) {
      log.likes.pull(userId);
    } else {
      log.likes.push(userId);

      if (String(log.user._id) !== String(userId)) {
        await Notification.create({
          type: "review_like",
          message: "liked your review",  // 🔥 Use short clean message without dynamic title
          from: userId,
          to: log.user._id,
          relatedId: log._id,  // Ensure this exists for frontend navigation
          read: false,
          createdAt: new Date(),
        });        
      }
    }

    await log.save();
    res.json({ liked: !liked });
  } catch (err) {
    console.error("❌ Like log failed:", err);
    res.status(500).json({ message: "Failed to like/unlike log" });
  }
});


router.get('/proxy/tmdb/images/:movieId', async (req, res) => {
  const movieId = req.params.movieId;

  try {
    const tmdbRes = await axios.get(`https://api.themoviedb.org/3/movie/${movieId}/images`, {
      params: {
        api_key: TMDB_API_KEY,
        include_image_language: 'en,null',
      },
    });
    res.json(tmdbRes.data);
  } catch (err) {
    console.error(`❌ TMDB proxy failed for movieId=${movieId}: ${err.message}`);
    res.status(500).json({ error: 'TMDB proxy failed.' });
  }
});

router.get('/proxy/tmdb', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).send("No URL provided.");

  try {
    const response = await axios.get(imageUrl, { responseType: 'stream' });
    res.setHeader('Content-Type', response.headers['content-type']);
    res.setHeader('Access-Control-Allow-Origin', '*');  // ⭐ Critical fix for html2canvas!
    response.data.pipe(res);
  } catch (err) {
    console.error(`❌ Failed to proxy image: ${err.message}`);
    res.status(500).send("Proxy failed.");
  }
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
          ratingForThisMovie,
          parentComment: r.parentComment || null // ✅ ADD THIS LINE!
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
    let tmdbPosterPath = null;

    if (log.movie && TMDB_API_KEY) {
      try {
        const tmdbRes = await axios.get(`https://api.themoviedb.org/3/movie/${log.movie}?api_key=${TMDB_API_KEY}`);
        backdrop_path = tmdbRes.data.backdrop_path;
        movieTitle = tmdbRes.data.title;
        tmdbPosterPath = tmdbRes.data.poster_path;
      } catch (err) {
        console.warn(`⚠️ Failed to fetch TMDB details for movieId=${log.movie}: ${err.message}`);
      }
    }

    // ✅ NEW: Check if the log owner has a custom poster for this movie
    let poster = DEFAULT_POSTER;

    const customPoster = await CustomPoster.findOne({
      userId: log.user._id,  // Scope correctly to log owner!
      movieId: log.movie
    });

    if (customPoster) {
      poster = customPoster.posterUrl;
    } else if (log.poster && log.poster.startsWith('http')) {
      poster = log.poster;
    } else if (tmdbPosterPath) {
      poster = `https://image.tmdb.org/t/p/w500${tmdbPosterPath}`;
    }

    const backdrop = backdrop_path ? `${TMDB_BACKDROP}${backdrop_path}` : DEFAULT_BACKDROP;
    const likes = log.likes || [];

    const replies = await Promise.all(
      (log.replies || []).map(async (r) => {
        let replyUser = null;
        let ratingForThisMovie = null;

        if (r.user) {
          replyUser = await User.findById(r.user).select('username avatar');
          const userLog = await Log.findOne({ user: replyUser?._id, movie: log.movie });
          if (userLog) ratingForThisMovie = userLog.rating || null;
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

    const rewatchCount = await Log.countDocuments({
      user: log.user,
      movie: log.movie
    });
    
    res.json({
      _id: log._id,
      user: log.user || null,
      movie: {
        id: log.movie || null,
        title: movieTitle,
        backdrop_path: backdrop_path || null,
        poster: poster  // ✅ Ensure movie.poster is correct
      },
      poster: poster,  // ✅ Ensure top-level poster is also correct
      posterOverride: poster,  // ✅ You can add this if frontend expects posterOverride prop
      backdrop,
      customBackdrop: log.customBackdrop || "",
      review: log.review || "",
      rating: log.rating || 0,
      rewatchCount,
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

router.post('/:id/reply', protect, upload.single('image'), async (req, res) => {
  const { text, gif, externalImage, parentComment } = req.body;

  try {
    const log = await Log.findById(req.params.id);
    if (!log) return res.status(404).json({ message: 'Log not found' });

    let uploadedImage = null;
    if (req.file) {
      uploadedImage = await uploadToCloudinary(req.file.buffer, "scene/replies");
    } else if (externalImage) {
      uploadedImage = externalImage;
    }

    if (!text && !uploadedImage && !gif) {
      return res.status(400).json({ message: 'Reply must include text, image, or gif.' });
    }

    const newReply = {
      user: req.user.id,
      text: text || "",
      gif: gif || "",
      image: uploadedImage || "",
      parentComment: parentComment || null,
    };

    log.replies.push(newReply);
    await log.save();

    // 🔔 Notify log owner if direct reply:
    if (!parentComment && log.user.toString() !== req.user._id.toString()) {
      await Notification.create({
        type: 'reply',
        message: 'replied to your review',  // ✅ Clean consistent message
        from: req.user._id,
        to: log.user,
        relatedId: log._id,
        read: false,
        createdAt: new Date(),
      });
    }

    // 🔔 Notify parent comment owner if replying to a comment:
    if (parentComment) {
      const parentReply = log.replies.id(parentComment);
      if (parentReply && parentReply.user.toString() !== req.user._id.toString()) {
        await Notification.create({
          type: 'reply',
          message: 'replied to your comment',  // ✅ Clean consistent message
          from: req.user._id,
          to: parentReply.user,
          relatedId: log._id,
          read: false,
          createdAt: new Date(),
        });
      }
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
      parentComment: latestReply.parentComment || null,
    });
  } catch (err) {
    console.error('🔥 Failed to post reply:', err);
    res.status(500).json({ message: err.message });
  }
});
// ✅ Review Like → Notify review owner
router.post('/:logId/like', protect, async (req, res) => {
  try {
    const log = await Log.findById(req.params.logId).populate('user', 'username');
    if (!log) return res.status(404).json({ message: 'Log not found' });

    const userId = req.user._id;
    const liked = log.likes.includes(userId);

    if (liked) {
      log.likes.pull(userId);
    } else {
      log.likes.push(userId);

      if (String(log.user._id) !== String(userId)) {
        await Notification.create({
          type: "review_like",  // ✅ Use consistent type
          message: "liked your review",  // ✅ Clean consistent message
          from: userId,
          to: log.user._id,
          relatedId: log._id,  // ✅ So frontend can navigate correctly
          read: false,
          createdAt: new Date(),
        });
      }
    }

    await log.save();
    res.json({ liked: !liked });
  } catch (err) {
    console.error("❌ Like review failed:", err);
    res.status(500).json({ message: "Failed to like/unlike review" });
  }
});

// ✅ Reply Like → Notify reply owner
router.post('/:logId/replies/:replyId/like', protect, async (req, res) => {
  try {
    const log = await Log.findById(req.params.logId);
    if (!log) return res.status(404).json({ message: 'Log not found' });

    const reply = log.replies.id(req.params.replyId);
    if (!reply) return res.status(404).json({ message: 'Reply not found' });

    const userId = req.user._id;
    const liked = reply.likes.includes(userId);

    if (liked) {
      reply.likes.pull(userId);
    } else {
      reply.likes.push(userId);

      if (String(reply.user) !== String(userId)) {
        await Notification.create({
          type: "reaction",  // ✅ Use consistent type for reply-like notifications
          message: "liked your reply",  // ✅ Clean consistent message
          from: userId,
          to: reply.user,
          relatedId: log._id,  // ✅ So frontend can navigate to /review/:relatedId
          read: false,
          createdAt: new Date(),
        });
      }
    }

    await log.save();
    res.json({ liked: !liked });
  } catch (err) {
    console.error("❌ Like reply failed:", err);
    res.status(500).json({ message: "Failed to like/unlike reply" });
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

// POST /api/logs/full → Full-featured log (text, rating, gif, image, etc.)
router.post('/full', protect, upload.single('image'), async (req, res) => {
  try {
    const {
      movieId,
      review,
      rating,
      rewatch,
      rewatchCount,
      gif,
      watchedAt,
      title,
      poster,
    } = req.body;

    const uploadedImage = req.file
      ? await uploadToCloudinary(req.file.buffer, "scene/logs")
      : "";

    const posterValue = poster && poster !== "undefined" ? poster : "";

    // ✅ Step 1: Make sure movie exists in DB, or create it
    const tmdbId = parseInt(movieId);
    if (!tmdbId || isNaN(tmdbId)) {
      return res.status(400).json({ message: "Invalid movieId" });
    }

    let movie = await Movie.findOne({ tmdbId });
    if (!movie) {
      try {
        const tmdbRes = await axios.get(
          `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`
        );
        const tmdbData = tmdbRes.data;

        movie = await Movie.create({
          tmdbId: tmdbData.id,
          title: tmdbData.title,
          posterPath: tmdbData.poster_path,
          releaseDate: tmdbData.release_date,
        });
      } catch (fetchErr) {
        console.error("❌ TMDB fetch failed:", fetchErr.message);
        return res.status(500).json({ message: "Failed to fetch movie data" });
      }
    }

    // ✅ Step 2: Save the log with correct movie._id
    const newLog = await Log.create({
      user: req.user._id,
      movie: movie._id, // ✅ safe reference
      review: review || "",
      rating: parseFloat(rating) || 0,
      rewatch: rewatch === "true" || false,
      rewatchCount: parseInt(rewatchCount) || 0,
      gif: gif || "",
      image: uploadedImage,
      watchedAt: watchedAt ? new Date(watchedAt) : Date.now(),
      title: title || movie.title || "",
      poster: posterValue || movie.posterPath || "",
      importedFrom: "manual", // optional: good for debugging later
    });

    res.status(201).json({ message: "✅ Log saved successfully!", log: newLog });
  } catch (err) {
    console.error("❌ Failed to save full log:", err);
    res.status(500).json({ message: "Failed to save full log", error: err.message });
  }
});



// PATCH /api/logs/:logId → Edit an existing log safely
router.patch('/:logId', protect, upload.single('image'), async (req, res) => {
  try {
    const log = await Log.findById(req.params.logId);
    if (!log) return res.status(404).json({ message: "Log not found" });

    console.log("🔍 PATCH user comparison:");
    console.log("log.user:", log.user);
    console.log("req.user._id:", req.user._id);

    if (!log.user) {
      console.warn("⚠️ Log has no user field:", log._id);
      return res.status(403).json({ message: "Unauthorized - log has no owner" });
    }

    if (log.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const {
      review,
      rating,
      rewatch,
      gif,
      watchedAt,
      title,
      poster
    } = req.body;

    const uploadedImage = req.file
      ? await uploadToCloudinary(req.file.buffer, "scene/logs")
      : log.image;

    log.review = review ?? log.review;
    log.rating = rating !== undefined ? parseFloat(rating) : log.rating;
    log.rewatch = rewatch === "true" ? true : log.rewatch;
    log.gif = gif ?? log.gif;
    log.image = uploadedImage;
    log.watchedAt = watchedAt ? new Date(watchedAt) : log.watchedAt;
    log.title = title ?? log.title;

    if (poster && poster !== "undefined") {
      log.poster = poster;
    }

    await log.save();

    res.json({ message: "✅ Log updated", log });
  } catch (err) {
    console.error("❌ PATCH failed:", err);
    res.status(500).json({ message: "Failed to update log" });
  }
});

// GET /api/logs/feed — Get logs from user + following
router.get('/feed/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const ids = [user._id, ...user.following];

    const logs = await Log.find({ user: { $in: ids } })
      .populate('user', 'username avatar')
      .populate('movie')
      .sort({ createdAt: -1 });

    const logsWithDetails = await Promise.all(
      logs.map(async (log) => {
        let posterUrl = null;
        const movieId = log.movie?.id || log.movie;

        // 🔥 Scope poster lookup correctly by userId + movieId:
        const customPoster = await CustomPoster.findOne({
          userId: log.user._id,
          movieId: Number(movieId)
        });

        if (customPoster) {
          posterUrl = customPoster.posterUrl;
        } else if (log.movie && log.movie.poster_path) {
          posterUrl = `${TMDB_IMG}${log.movie.poster_path}`;
        } else if (log.poster) {
          posterUrl = log.poster.startsWith("http") ? log.poster : `${TMDB_IMG}${log.poster}`;
        } else {
          posterUrl = "/default-poster.jpg";
        }

        return {
          ...log.toObject(),
          posterOverride: posterUrl
        };
      })
    );

    res.json(logsWithDetails);
  } catch (err) {
    console.error("🔥 Error fetching feed:", err);
    res.status(500).json({ message: "Failed to fetch feed" });
  }
});

// PATCH /api/logs/:logId/backdrop → Update custom backdrop
router.patch('/:logId/backdrop', expressJson, protect, async (req, res) => {
  const { backdrop } = req.body || {};  // Fallback safety too

  try {
    const log = await Log.findById(req.params.logId);
    if (!log) return res.status(404).json({ message: 'Log not found' });
    if (log.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    log.customBackdrop = backdrop || "";
    await log.save();

    res.json({ message: "Backdrop updated", customBackdrop: log.customBackdrop });
  } catch (err) {
    console.error("🔥 Error updating backdrop:", err);
    res.status(500).json({ message: "Failed to update backdrop" });
  }
});



router.delete('/:logId/replies/:replyId', protect, async (req, res) => {
  try {
    console.log(`👉 Attempting to delete replyId=${req.params.replyId} on logId=${req.params.logId} for user=${req.user._id}`);

    const log = await Log.findById(req.params.logId);
    console.log('🔍 Fetched log:', log ? 'FOUND' : 'NOT FOUND');

    if (!log) {
      return res.status(404).json({ message: 'Log not found' });
    }

    console.log('📝 log.replies IDs:', log.replies.map(r => r._id.toString()));
    const replyIndex = log.replies.findIndex(r => r._id.toString() === req.params.replyId);

    if (replyIndex === -1) {
      console.log('❌ Reply not found');
      return res.status(404).json({ message: 'Reply not found' });
    }

    const reply = log.replies[replyIndex];
    console.log(`✅ Found reply.user=${reply.user}`);

    if (reply.user && reply.user.toString() !== req.user._id.toString()) {
      console.log('❌ Unauthorized attempt to delete reply');
      return res.status(403).json({ message: 'Unauthorized' });
    }

    console.log('🗑️ Removing reply by splice...');
    log.replies.splice(replyIndex, 1);

    console.log('💾 Saving log...');
    await log.save({ validateBeforeSave: false });

    console.log('✅ Reply deleted successfully');
    res.json({ message: 'Reply deleted' });
  } catch (err) {
    console.error('🔥 Error deleting reply:', err);
    console.error('🔥 Error stack:', err.stack);
    res.status(500).json({ message: err.message });
  }
});


router.delete("/:logId", protect, async (req, res) => {
  try {
    const log = await Log.findById(req.params.logId);
    if (!log) return res.status(404).json({ message: "Log not found" });

    console.log("🔍 DELETE check - log.user:", log.user);
    console.log("🔍 DELETE check - req.user._id:", req.user._id);

    if (!log.user) {
      console.warn("⚠️ Log has no user field (legacy log?):", log._id);
      return res.status(403).json({ message: "Not authorized (no owner info)" });
    }

    if (log.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized to delete this log" });
    }

    // ✅ Robust deletion method (solves `remove is not a function` error):
    await Log.findByIdAndDelete(req.params.logId);

    await User.findByIdAndUpdate(req.user._id, { $inc: { totalLogs: -1 } });

    res.json({ message: "✅ Log deleted successfully!" });
  } catch (err) {
    console.error("🔥 Error in DELETE /api/logs/:logId:", err);
    res.status(500).json({ message: "Server error deleting log" });
  }
});

router.get('/user/:userId', protect, async (req, res) => {
  try {
    const profileUserId = req.params.userId;
    const viewerId = req.user._id.toString(); // ✅ Needed for poster override

    const logs = await Log.find({ user: profileUserId })
      .populate('user', 'username avatar')
      .sort({ createdAt: -1 });

    // 🔥 Deduplicate by movie
    const uniqueLogsMap = new Map();
    logs.forEach((log) => {
      const movieId = log.movie?.toString();
      if (movieId && !uniqueLogsMap.has(movieId)) {
        uniqueLogsMap.set(movieId, log);
      }
    });
    const uniqueLogs = Array.from(uniqueLogsMap.values());

    const logsWithDetails = await Promise.all(
      uniqueLogs.map(async (log) => {
        let posterUrl = null;
        let movieRuntime = null;
        let movieReleaseDate = null;

        const rawMovie = log.movie;

        // 🔒 Skip logs with broken movie references
        if (
          !rawMovie ||
          (!rawMovie._id && !rawMovie.id && typeof rawMovie !== "number" && typeof rawMovie !== "string")
        ) {
          console.warn("🚫 Skipping log with invalid movie reference:", log._id);
          return null;
        }

        // Extract TMDB ID safely
        const movieId =
          typeof rawMovie === "object"
            ? rawMovie.id || rawMovie._id?.toString()
            : rawMovie;

        if (!movieId || isNaN(movieId)) {
          console.warn("🚫 Skipping log due to NaN movieId:", log._id);
          return null;
        }

        try {
          const customPoster = await CustomPoster.findOne({
            userId: viewerId,
            movieId: Number(movieId),
          });

          if (customPoster) {
            posterUrl = customPoster.posterUrl;
          } else if (log.poster) {
            posterUrl = log.poster.startsWith("http")
              ? log.poster
              : `${TMDB_IMG}${log.poster}`;
          }
        } catch (err) {
          console.warn("❌ Failed to fetch custom poster:", err.message);
        }

        // 🔁 TMDB fallback
        if (!posterUrl && movieId && TMDB_API_KEY) {
          try {
            const tmdbRes = await axios.get(
              `https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB_API_KEY}`
            );
            const tmdbData = tmdbRes.data;
            if (tmdbData.poster_path) {
              posterUrl = `${TMDB_IMG}${tmdbData.poster_path}`;
            }
            movieRuntime = tmdbData.runtime || null;
            movieReleaseDate = tmdbData.release_date || null;
          } catch (err) {
            console.warn(`⚠️ TMDB fetch failed for logId ${log._id}: ${err.message}`);
          }
        }

        return {
          ...log.toObject(),
          posterOverride: posterUrl,
          movie: {
            id: movieId,
            runtime: movieRuntime,
            release_date: movieReleaseDate,
          },
        };
      })
    );

    res.json(logsWithDetails.filter(Boolean)); // ❄️ Remove nulls
  } catch (err) {
    console.error("🔥 Server crash in /api/logs/user/:userId:", err);
    res.status(500).json({ message: 'Failed to fetch user logs', error: err.message });
  }
});



router.post('/:logId/replies/:replyId/like', protect, async (req, res) => {
  try {
    const log = await Log.findById(req.params.logId);
    if (!log) return res.status(404).json({ message: 'Log not found' });

    const reply = log.replies.id(req.params.replyId);
    if (!reply) return res.status(404).json({ message: 'Reply not found' });

    const userId = req.user._id;
    const liked = reply.likes.includes(userId);

    if (liked) {
      reply.likes.pull(userId);
    } else {
      reply.likes.push(userId);

      if (String(reply.user) !== String(userId)) {
        await Notification.create({
          type: "reaction",  // ✅ Match frontend expectation exactly
          message: "liked your reply",  // ✅ Clean consistent message
          from: userId,
          to: reply.user,
          relatedId: log._id,  // ✅ Ensure frontend can navigate to /review/:relatedId
          read: false,
          createdAt: new Date(),
        });
      }
    }

    await log.save();
    res.json({ liked: !liked });
  } catch (err) {
    console.error("❌ Failed to like/unlike reply:", err);
    res.status(500).json({ message: "Failed to like/unlike reply", error: err.message });
  }
});


router.get('/user/:userId/movie/:movieId', async (req, res) => {
  try {
    const logs = await Log.find({
      user: req.params.userId,
      movie: req.params.movieId,
    }).sort({ createdAt: -1 });

    res.json(logs);
  } catch (err) {
    console.error("🔥 Failed to fetch logs for user/movie:", err);
    res.status(500).json({ message: "Failed to fetch logs for user/movie" });
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

// 🚨 TEMPORARY cleanup route
// 🧼 TEMP CLEANUP ROUTE — Delete logs before July 3, 2025
router.delete("/debug/delete-old-logs", async (req, res) => {
  try {
    const result = await Log.deleteMany({
      user: "68666f7a7b759477f069c7af",
      createdAt: { $lt: new Date("2025-07-03T00:00:00Z") },
    });

    res.json({ message: `✅ Deleted ${result.deletedCount} old logs.` });
  } catch (err) {
    console.error("❌ Cleanup failed:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});



module.exports = router;
