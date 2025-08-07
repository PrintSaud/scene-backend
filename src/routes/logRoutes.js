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
const Movie = require("../models/movieModel");
const { subDays, subHours } = require("date-fns");
const mongoose = require("mongoose");

async function formatLogsWithPoster(logs, viewerId) {
  return await Promise.all(
    logs.map(async (log) => {
      let movieId =
        log.movie?.id ||
        log.tmdbId ||
        (typeof log.movie === "number" ? log.movie : null);

      if (!movieId || isNaN(Number(movieId))) return null;

      let movieData = log.movie;

      // 🧠 If no full data, try TMDB
      if (!movieData || !movieData.poster_path) {
        try {
          const tmdbRes = await axios.get(
            `https://api.themoviedb.org/3/movie/${movieId}?api_key=${process.env.TMDB_API_KEY}`
          );
          movieData = tmdbRes.data;
        } catch (err) {
          console.warn("⚠️ TMDB fetch failed for movieId:", movieId);
          return null;
        }
      }

      // 🖼️ Poster Logic
      let posterUrl = "/default-poster.jpg";
      const customPoster = await CustomPoster.findOne({
        userId: viewerId,
        movieId: Number(movieId),
      });

      if (customPoster) {
        posterUrl = customPoster.posterUrl;
      } else if (movieData.poster_path) {
        posterUrl = `${TMDB_IMG}${movieData.poster_path}`;
      }

      return {
        ...log.toObject(),
        posterOverride: posterUrl,
        movie: movieData,
      };
    })
  ).then((logs) => logs.filter(Boolean));
}


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
        const notif = await Notification.create({
          type: "review_like",
          message: "liked your review",
          from: userId,
          to: log.user._id,
          relatedId: log._id,
          read: false,
          createdAt: new Date(),
        });

        // 📡 Real-time notif
        const io = req.app.get("io");
        const fromUser = await User.findById(userId).select("username avatar");
        io.to(log.user._id.toString()).emit("notification", {
          ...notif._doc,
          from: fromUser,
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

// logs.js
router.get('/:logId/replies', async (req, res) => {
  try {
    const log = await Log.findById(req.params.logId);
    if (!log) return res.status(404).json({ message: 'Log not found' });

    const replies = await Promise.all(
      (log.replies || []).map(async (r) => {
        const replyUser = await User.findById(r.user).select('username avatar');

        // Fetch that user's rating for this movie (if any)
        let rating = null;
        if (replyUser) {
          const userLog = await Log.findOne({
            user: replyUser._id,
            movie: log.movie
          });
          if (userLog) {
            rating = userLog.rating || null;
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
          rating: rating, // ✅ Final field name for frontend
          parentComment: r.parentComment || null
        };
      })
    );

    res.json(replies);
  } catch (err) {
    console.error('🔥 Error fetching replies:', err);
    res.status(500).json({ message: "Failed to fetch replies" });
  }
});


// ✅ Add this FIRST — before router.get("/:logId")
router.get("/debug", protect, async (req, res) => {
  try {
    const logs = await Log.find({ user: req.user._id });
    console.log("📦 Total logs:", logs.length);

    logs.forEach((log, i) => {
      const movieField = log.movie;
      const isValid = typeof movieField === "number" && !isNaN(movieField);
      console.log(
        `#${i + 1} Movie Field:`,
        movieField,
        "| Type:",
        typeof movieField,
        "| Valid Number:",
        isValid
      );
    });

    res.json({ message: "✅ Check terminal logs", totalLogs: logs.length });
  } catch (err) {
    console.error("❌ Debug failed:", err);
    res.status(500).json({ error: err.message });
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

    // ✅ Correct way: always use tmdbId (not log.movie)
    const tmdbId = log.tmdbId;

    if (tmdbId && TMDB_API_KEY) {
      try {
        const tmdbRes = await axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`);
        console.log("🎬 TMDB movie response:", tmdbRes.data);
        backdrop_path = tmdbRes.data.backdrop_path;
        movieTitle = tmdbRes.data.title;
        tmdbPosterPath = tmdbRes.data.poster_path;

        if (!backdrop_path) {
          const fallbackRes = await axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}/images?api_key=${TMDB_API_KEY}`);
          backdrop_path = fallbackRes.data.backdrops?.[0]?.file_path || null;
          console.log("🧩 Fallback backdrop_path:", backdrop_path);
        }
      } catch (err) {
        console.warn(`⚠️ Failed to fetch TMDB for tmdbId=${tmdbId}: ${err.message}`);
      }
    }

    // ✅ Poster logic
    let poster = DEFAULT_POSTER;

    const customPoster = await CustomPoster.findOne({
      userId: log.user._id,
      movieId: tmdbId
    });

    if (customPoster) {
      poster = customPoster.posterUrl;
    } else if (log.poster && log.poster.startsWith('http')) {
      poster = log.poster;
    } else if (tmdbPosterPath) {
      poster = `https://image.tmdb.org/t/p/w500${tmdbPosterPath}`;
    }

    const backdrop = backdrop_path
      ? `${TMDB_BACKDROP}${backdrop_path}`
      : DEFAULT_BACKDROP;

    console.log("✅ Final backdrop URL sent to frontend:", backdrop);

    const likes = log.likes || [];

    const replies = await Promise.all(
      (log.replies || []).map(async (r) => {
        let replyUser = null;
        let ratingForThisMovie = null;

        if (r.user) {
          // ✅ Check if already populated
          if (typeof r.user === "object" && r.user.username) {
            replyUser = r.user;
          } else {
            replyUser = await User.findById(r.user).select('username avatar');
          }
        
          const userLog = await Log.findOne({ user: replyUser?._id, tmdbId });
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
      tmdbId: log.tmdbId,
      rewatch: true,
    });

    const totalWatches = await Log.countDocuments({
      user: log.user,
      tmdbId: log.tmdbId,
    });

    res.json({
      _id: log._id,
      user: log.user || null,
      movie: {
        id: log.tmdbId || null,
        title: movieTitle,
        backdrop_path: backdrop_path || null,
        poster
      },
      poster,
      posterOverride: poster,
      backdrop,
      customBackdrop: log.customBackdrop || "",
      review: log.review || "",
      rating: log.rating || 0,
      rewatchCount,
      likes,
      image: log.image || null,
      gif: log.gif || null,
      replies,
      createdAt: log.createdAt,
      reviewBackdrop: backdrop_path || null
    });

  } catch (err) {
    console.error("🔥 Error in GET /api/logs/:logId:", err);
    res.status(500).json({ message: "Server error in /api/logs/:logId" });
  }
});


router.post('/:id/reply', protect, upload.single('image'), async (req, res) => {
  const { text, gif, externalImage, parentComment } = req.body;

  console.log("📥 Incoming reply:");
  console.log("text:", text);
  console.log("gif:", gif);
  console.log("externalImage:", externalImage);
  console.log("parentComment:", parentComment);
  console.log("req.user:", req.user);

  try {
    const log = await Log.findById(req.params.id);
    if (!log) return res.status(404).json({ message: 'Log not found' });

    let uploadedImage = null;

    if (req.file?.buffer) {
      console.log("🌤 Uploading local image to Cloudinary...");
      uploadedImage = await uploadToCloudinary(req.file.buffer, "scene/replies");
    } else if (externalImage) {
      console.log("🌐 Using external image URL...");
      uploadedImage = externalImage;
    }

    if (!text && !uploadedImage && !gif) {
      return res.status(400).json({ message: 'Reply must include text, image, or gif.' });
    }

    // ✅ FIX: Ensure user is a real ObjectId
    const newReply = {
      user: new mongoose.Types.ObjectId(req.user._id),
      text: text || "",
      gif: gif || "",
      image: uploadedImage || "",
      parentComment: parentComment || null,
    };

    log.replies.push(newReply);
    await log.save();

    // ✅ FIX: Populate reply.user now
    await log.populate("replies.user", "username avatar");

    const latestReply = log.replies[log.replies.length - 1];
    const io = req.app.get("io");
    const fromUser = await User.findById(req.user._id).select("username avatar");

    // 🔔 Notify log owner
    if (!parentComment && String(log.user) !== String(req.user._id)) {
      const notif = await Notification.create({
        type: 'reply',
        message: 'replied to your review',
        from: req.user._id,
        to: log.user,
        relatedId: log._id,
        read: false,
        createdAt: new Date(),
      });

      io.to(log.user.toString()).emit("notification", {
        ...notif._doc,
        from: fromUser,
      });
    }

    // 🔔 Notify parent comment owner
    if (parentComment) {
      const parentReply = log.replies.id(parentComment);
      if (parentReply && String(parentReply.user) !== String(req.user._id)) {
        const notif = await Notification.create({
          type: 'reply',
          message: 'replied to your comment',
          from: req.user._id,
          to: parentReply.user,
          relatedId: log._id,
          read: false,
          createdAt: new Date(),
        });

        io.to(parentReply.user.toString()).emit("notification", {
          ...notif._doc,
          from: fromUser,
        });
      }
    }

    // ✅ Return clean reply object with populated user
    res.status(201).json({
      _id: latestReply._id,
      text: latestReply.text,
      gif: latestReply.gif,
      image: latestReply.image,
      createdAt: latestReply.createdAt,
      user: {
        _id: latestReply.user._id,
        username: latestReply.user.username,
        avatar: latestReply.user.avatar || DEFAULT_AVATAR,
      },
      parentComment: latestReply.parentComment || null,
      likes: [],
      logId: log._id,
    });

  } catch (err) {
    console.error('🔥 Failed to post reply:', err);
    res.status(500).json({ message: err.message || "Internal server error" });
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

      // 🔔 Only notify if liking someone else's review
      if (String(log.user._id) !== String(userId)) {
        const fromUser = await User.findById(userId);
        const io = req.app.get("io");

        const notif = await Notification.create({
          type: "review_like",
          message: "liked your review",
          from: userId,
          to: log.user._id,
          relatedId: log._id,
          read: false,
          createdAt: new Date(),
        });

        // 📡 Emit real-time notification
        io.to(log.user._id.toString()).emit("notification", {
          ...notif._doc,
          from: {
            _id: fromUser._id,
            username: fromUser.username,
            avatar: fromUser.avatar,
          },
        });
      }
    }

    await log.save();
    res.json({ liked: !liked });
  } catch (err) {
    console.error("❌ Like review failed:", err);
    res.status(500).json({ message: "Failed to like/unlike review", error: err.message });
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

      // 🔔 Send notification only if user is not liking their own reply
      if (String(reply.user) !== String(userId)) {
        const fromUser = await User.findById(userId);
        const io = req.app.get("io");

        const notif = await Notification.create({
          type: "reaction",
          message: "liked your reply",
          from: userId,
          to: reply.user,
          relatedId: log._id,
          read: false,
          createdAt: new Date(),
        });

        // 🚀 Emit real-time notification
        io.to(reply.user.toString()).emit("notification", {
          ...notif._doc,
          from: {
            _id: fromUser._id,
            username: fromUser.username,
            avatar: fromUser.avatar,
          },
        });
      }
    }

    await log.save();
    res.json({ liked: !liked });
  } catch (err) {
    console.error("❌ Like reply failed:", err);
    res.status(500).json({ message: "Failed to like/unlike reply", error: err.message });
  }
});

// Popular Logs
router.get('/movie/:id/popular', protect, async (req, res) => {
  try {
    const logs = await Log.find({ tmdbId: parseInt(req.params.id), review: { $exists: true } })
      .populate('user', 'username avatar')
      .sort({ createdAt: -1 })
      .limit(10);
    res.json(logs);
  } catch (err) {
    console.error("❌ Popular logs fetch error:", err);
    res.status(500).json({ message: err.message });
  }
});

// Friend Logs
router.get('/movie/:id/friends', protect, async (req, res) => {
  try {
    const friends = req.user.following || [];
    const logs = await Log.find({
      tmdbId: parseInt(req.params.id),
      user: { $in: friends },
    })
      .populate('user', 'username avatar')
      .sort({ createdAt: -1 });

    res.json(logs);
  } catch (err) {
    console.error("❌ Friend logs fetch error:", err);
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
      backdrop, // ✅ ADD THIS LINE
    } = req.body;
    

    const uploadedImage = req.file
      ? await uploadToCloudinary(req.file.buffer, "scene/logs")
      : "";

    const posterValue = poster && poster !== "undefined" ? poster : "";

    // ✅ Step 1: Normalize and check TMDB ID
    const tmdbId = movieId && typeof movieId === "string" ? parseInt(movieId) : movieId;
    if (!tmdbId || isNaN(tmdbId)) {
      return res.status(400).json({ message: "Invalid movieId" });
    }

    // ✅ Step 2: Lookup or create Movie
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
          backdropPath: tmdbData.backdrop_path,
        });
      } catch (fetchErr) {
        console.error("❌ TMDB fetch failed:", fetchErr.message);
        return res.status(500).json({ message: "Failed to fetch movie data" });
      }
    }

    // ✅ Final safety check
    if (!movie || !movie._id) {
      return res.status(500).json({ message: "Movie document invalid or missing _id" });
    }

    const combinedReview =
    review && review.trim()
      ? review.trim()
      : gif || uploadedImage
      ? "__media__"
      : "";
  

    // ✅ Step 3: Create Log
    const newLog = await Log.create({
      user: req.user._id,
      tmdbId: movie.tmdbId,
      review: combinedReview, // 👈 Important fix
      rating: parseFloat(rating) || 0,
      rewatch: rewatch === "true" || false,
      rewatchCount: parseInt(rewatchCount) || 0,
      gif: gif || "",
      image: uploadedImage,
      watchedAt: watchedAt ? new Date(watchedAt) : Date.now(),
      title: title || movie.title || "",
      poster: posterValue || movie.posterPath || "",
      backdrop: backdrop || movie.backdrop_path || "",
      importedFrom: "manual",
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
router.get('/feed/:id', protect, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) return res.status(404).json({ message: "User not found" });

    const ids = [user._id, ...user.following];

    const logs = await Log.find({ user: { $in: ids } })
      .populate("user", "username avatar")
      .populate("movie") // may be null if imported
      .sort({ createdAt: -1 })
      .limit(60);

    const logsWithDetails = await Promise.all(
      logs.map(async (log) => {
        let movieId =
          log.movie?.id ||
          log.tmdbId ||
          (typeof log.movie === "number" ? log.movie : null);

        if (!movieId || isNaN(Number(movieId))) return null;

        let movieData = log.movie;

        // 🔍 If no full movie data, fetch from TMDB using tmdbId
        if (!movieData || !movieData.poster_path) {
          try {
            const tmdbRes = await axios.get(
              `https://api.themoviedb.org/3/movie/${movieId}?api_key=${process.env.TMDB_API_KEY}`
            );
            movieData = tmdbRes.data;
          } catch (err) {
            console.warn("⚠️ TMDB fetch failed for movieId:", movieId);
            return null; // skip if TMDB failed
          }
        }

        // 🖼️ Poster logic
        let posterUrl = "/default-poster.jpg";

        const customPoster = await CustomPoster.findOne({
          userId: log.user._id,
          movieId: Number(movieId),
        });

        if (customPoster) {
          posterUrl = customPoster.posterUrl;
        } else if (movieData.poster_path) {
          posterUrl = `${TMDB_IMG}${movieData.poster_path}`;
        }

        return {
          ...log.toObject(),
          posterOverride: posterUrl,
          movie: movieData, // 🟢 for frontend fallback
        };
      })
    );

    res.json(logsWithDetails.filter(Boolean));
  } catch (err) {
    console.error("🔥 Error fetching feed:", err);
    res.status(500).json({ message: "Failed to fetch feed" });
  }
});

// Get logs from followings for a specific movie
router.get("/movie/:tmdbId/friends", protect, async (req, res) => {
  const userId = req.user._id;
  const { tmdbId } = req.params;

  const user = await User.findById(userId);
  const followingIds = user.following;

  const logs = await Log.find({
    user: { $in: followingIds },
    tmdbId: parseInt(tmdbId),
  })
    .sort({ createdAt: -1 })
    .limit(20)
    .populate("user", "username avatar");

  res.json(logs);
});

// 📌 Get top 3 liked reviews for a specific movie
router.get("/movie/:id/popular", protect, async (req, res) => {
  try {
    const movieId = parseInt(req.params.id);
    const returnAll = req.query.all === "true";

    const logs = await Log.find({
      tmdbId: movieId,
      review: { $exists: true, $ne: "" },
    })
      .sort({ "likes.length": -1 })
      .limit(returnAll ? 50 : 3)
      .populate("user", "username avatar");

    const formatted = await Promise.all(
      logs.map(async (log) => {
        const replies = await Promise.all(
          (log.replies || []).map(async (r) => {
            try {
              let replyUser = null;
        
              if (typeof r.user === "object" && r.user?.username) {
                replyUser = r.user; // already populated
              } else if (typeof r.user === "string") {
                replyUser = await User.findById(r.user).select("username avatar");
              }
        
              return {
                _id: r._id,
                text: r.text || "",
                gif: r.gif || "",
                image: r.image || "",
                createdAt: r.createdAt,
                likes: Array.isArray(r.likes) ? r.likes : [],
                parentComment: r.parentComment || null,
                user: replyUser
                  ? {
                      _id: replyUser._id,
                      username: replyUser.username,
                      avatar: replyUser.avatar,
                    }
                  : {
                      _id: r.user || null,
                      username: "Unknown",
                      avatar: "/default-avatar.jpg",
                    },
              };
            } catch (err) {
              console.warn("⚠️ Failed to load reply user:", r.user, err.message);
              return {
                _id: r._id,
                text: r.text || "",
                gif: r.gif || "",
                image: r.image || "",
                createdAt: r.createdAt,
                likes: Array.isArray(r.likes) ? r.likes : [],
                parentComment: r.parentComment || null,
                user: {
                  _id: r.user || null,
                  username: "Unknown",
                  avatar: "/default-avatar.jpg",
                },
              };
            }
          })
        );
        

        return {
          _id: log._id,
          user: {
            _id: log.user._id,
            username: log.user.username,
            avatar: log.user.avatar,
          },
          review: log.review,
          rating: log.rating,
          rewatchCount: log.rewatchCount || 0,
          createdAt: log.createdAt,
          gif: log.gif,
          image: log.image,
          likes: log.likes || [],
          replies,
        };
      })
    );

    res.json(formatted);
  } catch (err) {
    console.error("❌ Failed to fetch popular reviews:", err);
    res.status(500).json({ message: "Server error while fetching reviews" });
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

    const logs = await Log.find({ user: profileUserId })
      .populate('user', 'username avatar')
      .populate('replies.user', 'username avatar')
      .sort({ createdAt: -1 })
      .lean();

    const uniqueLogsMap = new Map();
    logs.forEach((log) => {
      const movieId = log.movie?.id || log.movie?.toString() || log.tmdbId;
      if (movieId && !uniqueLogsMap.has(movieId)) {
        uniqueLogsMap.set(movieId, log);
      }
    });

    const uniqueLogs = Array.from(uniqueLogsMap.values());

    const movieIds = uniqueLogs.map((log) => {
      return log.tmdbId || (typeof log.movie === 'object' ? log.movie?.id : log.movie);
    }).filter(Boolean);

    const posters = await CustomPoster.find({
      userId: profileUserId,
      movieId: { $in: movieIds },
    });

    const posterMap = {};
    posters.forEach((p) => {
      posterMap[p.movieId] = p.posterUrl;
    });

    const logsWithPosters = await Promise.all(
      uniqueLogs.map(async (log) => {
        const rawMovie = log.movie;
        const movieId =
          (typeof rawMovie === "object" && rawMovie.id) ||
          (typeof rawMovie === "number" && rawMovie) ||
          log.tmdbId || null;

        if (!movieId || isNaN(movieId)) {
          console.warn(`🚫 Skipping log due to NaN movieId: ${log._id}`);
          return null;
        }

        let posterUrl = posterMap[movieId] || null;
        let runtime = null;
        let releaseDate = null;

        if (!posterUrl && TMDB_API_KEY) {
          try {
            const tmdbRes = await axios.get(
              `https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB_API_KEY}`
            );
            const tmdb = tmdbRes.data;
            posterUrl = tmdb.poster_path ? `${TMDB_IMG}${tmdb.poster_path}` : null;
            runtime = tmdb.runtime || null;
            releaseDate = tmdb.release_date || null;
          } catch (err) {
            console.warn(`⚠️ TMDB fetch failed for logId ${log._id}: ${err.message}`);
          }
        }

        return {
          ...log,
          posterOverride: posterUrl,
          movie: {
            id: movieId,
            runtime,
            release_date: releaseDate,
          },
        };
      })
    );

    const validLogs = logsWithPosters.filter(Boolean);
    res.json(validLogs);
  } catch (err) {
    console.error("🔥 Server crash in /api/logs/user/:userId:", err);
    res.status(500).json({ message: 'Failed to fetch user logs', error: err.message });
  }
});

// src/routes/logRoutes.js
router.post("/:id/share", protect, async (req, res) => {
  const { recipients } = req.body;
  const logId = req.params.id;
  const userId = req.user._id;

  console.log("📤 SHARING REVIEW FIRED — reviewId:", logId);
  console.log("🔗 Recipients:", recipients);

  try {
    const log = await Log.findById(logId);
    if (!log) return res.status(404).json({ message: "Review not found" });

    const fromUser = await User.findById(userId);
    const io = req.app.get("io");

    await Promise.all(
      recipients.map(async (rid) => {
        const notif = await Notification.create({
          type: "share-review",
          message: "suggested you to check out this review!",
          from: userId,
          to: rid,
          reviewId: log._id,
          movieId: log.tmdbId || log.movie?.id,
          read: false,
          createdAt: new Date(),
        });

        console.log("✅ Created share-review notif for", rid, "→", notif._id);

        // 🔔 Emit real-time notification
        io.to(rid).emit("notification", {
          ...notif._doc,
          from: {
            _id: fromUser._id,
            username: fromUser.username,
            avatar: fromUser.avatar,
          },
        });
      })
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Failed to share review:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/:logId/replies/:replyId/like", protect, async (req, res) => {
  try {
    const log = await Log.findById(req.params.logId);
    if (!log) return res.status(404).json({ message: "Log not found" });

    const reply = log.replies.id(req.params.replyId);
    if (!reply) return res.status(404).json({ message: "Reply not found" });

    if (!Array.isArray(reply.likes)) reply.likes = [];

    const userId = req.user._id;
    const liked = reply.likes.some((id) => String(id) === String(userId));

    if (liked) {
      reply.likes = reply.likes.filter((id) => String(id) !== String(userId));
    } else {
      reply.likes.push(userId);

      if (String(reply.user) !== String(userId)) {
        const fromUser = await User.findById(userId);

        const notif = await Notification.create({
          type: "reaction",
          message: "liked your reply",
          from: userId,
          to: reply.user,
          relatedId: log._id,
          read: false,
          createdAt: new Date(),
        });

        const io = req.app.get("io");
        io.to(reply.user.toString()).emit("notification", {
          ...notif._doc,
          from: {
            _id: fromUser._id,
            username: fromUser.username,
            avatar: fromUser.avatar,
          },
        });
      }
    }

    await log.save();

    res.json({
      liked: !liked,
      likesCount: reply.likes.length,
    });
  } catch (err) {
    console.error("❌ Failed to like/unlike reply:", err);
    res.status(500).json({ message: "Failed to like/unlike reply", error: err.message });
  }
});


router.get('/user/:userId/movie/:movieId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const tmdbId = parseInt(req.params.movieId);
    if (!userId || isNaN(tmdbId)) {
      return res.status(400).json({ message: "Invalid user or movie ID" });
    }

    const logs = await Log.find({
      user: userId,
      tmdbId: tmdbId,
    }).sort({ createdAt: -1 });

    res.json(logs);
  } catch (err) {
    console.error("🔥 Failed to fetch logs for user/movie:", err.message);
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

module.exports = router;
