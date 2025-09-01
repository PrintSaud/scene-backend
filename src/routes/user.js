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
const upload = multer({ storage: multer.memoryStorage() }); // ✅ in-memory upload
const axios = require("axios");
const TMDB_API_KEY = process.env.TMDB_API_KEY;
// ✅ Save recent GIF
router.post("/gif/recent", async (req, res) => {
  const { userId, gifUrl } = req.body;

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    // Add gif to top, remove duplicates
    user.recentGifs = [gifUrl, ...user.recentGifs.filter((g) => g !== gifUrl)];

    // Keep only last 20
    if (user.recentGifs.length > 20) {
      user.recentGifs = user.recentGifs.slice(0, 20);
    }

    await user.save();
    res.status(200).json({ success: true, recentGifs: user.recentGifs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
  const query = req.query.query || "";

  if (!query.trim()) return res.json([]);

  try {
    const users = await User.find({
      username: { $regex: query, $options: "i" },
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



// ✅ PLACE THIS ABOVE any `/:id` route
router.get('/all', async (req, res) => {
  try {
    const users = await User.find({}, 'username email avatar createdAt');
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching users', error: err.message });
  }
});


// followww
// follow / unfollow
router.post('/:userId/follow/:targetId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    const targetUser = await User.findById(req.params.targetId);

    if (!user || !targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isFollowing = user.following.includes(req.params.targetId);

    // 🚫 Prevent new follows if blocked
    if (!isFollowing && targetUser.noNewFollowers) {
      console.log("🚨 Blocked follow attempt on", targetUser.username);
      return res.status(403).json({
        error: "🚫 يلا بس",
      });
    }

    if (isFollowing) {
      // ✅ Unfollow
      user.following.pull(req.params.targetId);
      targetUser.followers.pull(req.params.userId);
    } else {
      // ✅ Follow
      user.following.push(req.params.targetId);
      targetUser.followers.push(req.params.userId);

      const notif = await Notification.create({
        type: "follow",
        message: `@${user.username} just followed you`,
        from: user._id,
        to: targetUser._id,
        read: false,
        createdAt: new Date(),
      });

      // Real-time notification
      const io = req.app.get("io");
      io.to(targetUser._id.toString()).emit("notification", {
        ...notif._doc,
        from: {
          _id: user._id,
          username: user.username,
          avatar: user.avatar,
        },
      });
    }

    // ✅ Clean corrupted watchlist entries
    user.watchlist = (user.watchlist || []).filter(
      (item) => item && typeof item === "object" && typeof item.tmdbId === "number"
    );
    targetUser.watchlist = (targetUser.watchlist || []).filter(
      (item) => item && typeof item === "object" && typeof item.tmdbId === "number"
    );

    await user.save();
    await targetUser.save();

    res.status(200).json({
      following: !isFollowing,
      message: isFollowing ? "Unfollowed user" : "Now following user",
    });
  } catch (err) {
    console.error("❌ Failed to toggle follow:", err);
    res.status(500).json({ error: "Failed to toggle follow", details: err.message });
  }
});

  router.post('/:id/custom-poster', async (req, res) => {
    const { movieId, newPoster } = req.body;
  
    try {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ message: 'User not found' });
  
      // 🔔 Add this to ensure movieId stored as string key:
      user.customPosters.set(String(movieId), newPoster);
  
      await user.save();
  
      res.status(200).json({ message: 'Poster updated successfully' });
    } catch (err) {
      res.status(500).json({ message: 'Something went wrong', error: err.message });
    }
  });
  

  router.put('/:id/backdrop', async (req, res) => {
    const { backdropPath } = req.body;
  
    try {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ message: 'User not found' });
  
      user.profileBackdrop = backdropPath;
      await user.save();
  
      res.status(200).json({ message: 'Backdrop updated successfully' });
    } catch (err) {
      res.status(500).json({ message: 'Error updating backdrop', error: err.message });
    }
  });

  router.get('/:id/backdrop', async (req, res) => {
    try {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ message: 'User not found' });
  
      res.status(200).json({ backdrop: user.profileBackdrop });
    } catch (err) {
      res.status(500).json({ message: 'Error fetching backdrop', error: err.message });
    }
  });
 

  router.put('/:id/top-movies', async (req, res) => {
    const { topMovies } = req.body;

  
    if (!Array.isArray(topMovies) || topMovies.length > 4) {
      return res.status(400).json({ message: 'Top movies must be an array with max 5 items.' });
    }
  
    try {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ message: 'User not found' });
  
      user.topMovies = topMovies;
      await user.save();
  
      res.status(200).json({ message: 'Top movies updated successfully' });
    } catch (err) {
      res.status(500).json({ message: 'Error updating top movies', error: err.message });
    }
  });

  router.get('/:id/top-movies', async (req, res) => {
    try {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ message: 'User not found' });
  
      res.status(200).json({ topMovies: user.topMovies });
    } catch (err) {
      res.status(500).json({ message: 'Error fetching top movies', error: err.message });
    }
  });

  
  router.get('/username/:username', async (req, res) => {
    try {
      const user = await User.findOne({ username: req.params.username });
      if (!user) return res.status(404).json({ message: 'User not found' });
  
      // Return only public info
      const publicProfile = {
        username: user.username,
        bio: user.bio,
        favoriteCharacter: user.favoriteCharacter,
        favoriteActor: user.favoriteActor,
        topMovies: user.topMovies,
        profileBackdrop: user.profileBackdrop,
        // You can expand this with recent logs, etc. later
      };
  
      res.status(200).json(publicProfile);
    } catch (err) {
      res.status(500).json({ message: 'Error fetching user by username', error: err.message });
    }
  });

// ADD favorite (numeric TMDB id)
router.post('/:userId/favorites/:tmdbId', protect, async (req, res) => {
  try {
    const { userId, tmdbId } = req.params;
    const idNum = Number(tmdbId);
    if (!/^[0-9a-fA-F]{24}$/.test(userId)) return res.status(400).json({ error: 'Invalid userId' });
    if (!Number.isInteger(idNum)) return res.status(400).json({ error: 'tmdbId (number) required' });

    await User.updateOne(
      { _id: userId },
      { $addToSet: { favorites: idNum } },
      { runValidators: false } // <- critical
    );

    const fresh = await User.findById(userId).select('favorites').lean();
    return res.status(200).json({ message: 'Added to favorites', favorites: fresh?.favorites || [] });
  } catch (err) {
    console.error('favorites POST error:', err);
    return res.status(500).json({ error: err?.message || 'Server error' });
  }
});

// REMOVE favorite
router.delete('/:userId/favorites/:tmdbId', protect, async (req, res) => {
  try {
    const { userId, tmdbId } = req.params;
    const idNum = Number(tmdbId);
    if (!/^[0-9a-fA-F]{24}$/.test(userId)) return res.status(400).json({ error: 'Invalid userId' });
    if (!Number.isInteger(idNum)) return res.status(400).json({ error: 'tmdbId (number) required' });

    await User.updateOne(
      { _id: userId },
      { $pull: { favorites: idNum } },
      { runValidators: false } // <- critical
    );

    const fresh = await User.findById(userId).select('favorites').lean();
    return res.json({ message: 'Removed from favorites', favorites: fresh?.favorites || [] });
  } catch (err) {
    console.error('favorites DELETE error:', err);
    return res.status(500).json({ error: err?.message || 'Server error' });
  }
});

// GET /api/users/:id  (profile payload)
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });

    const customPostersDocs = await CustomPoster.find({ userId: req.params.id });
    const customPosters = {};
    for (const doc of customPostersDocs) customPosters[doc.movieId] = doc.posterUrl;

    const uniqueFilms = await Log.distinct('movie', { user: req.params.id });
    const totalLogs = uniqueFilms.length;
    const followerCount = await User.countDocuments({ following: req.params.id });
    const recentLogs = await Log.find({ user: req.params.id })
      .sort({ createdAt: -1 })
      .limit(4)
      .select('movie title poster rating rewatch createdAt review')
      .lean();

    // ✅ Keep Top-4 as objects
    const favoriteFilms = Array.isArray(user.favoriteFilms) ? user.favoriteFilms : [];

    // ✅ Hearts/likes list as numbers (if you have this field)
    const favorites = (user.favorites || [])
      .map((n) => Number(n))
      .filter(Number.isFinite);

    res.json({
      ...user,
      favoriteFilms,           // used by ProfileTabProfile top-4 grid
      favorites,               // used by heart/like UI across the app
      customPosters,
      totalLogs,
      followerCount,
      followingCount: user.following?.length || 0,
      recentLogs,
    });
  } catch (err) {
    console.error('❌ Failed to get user profile:', err);
    res.status(500).json({ message: 'Failed to fetch user', error: err.message });
  }
});

// PATCH /api/users/:id — update user profile (safe merge)
router.patch("/:id", protect, upload.single("avatar"), async (req, res) => {
  try {
    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const patch = {};

    // avatar (optional)
    if (req.file) {
      const cloudUrl = await uploadToCloudinary(
        req.file.buffer,
        "scene/avatars"
      );
      patch.avatar = cloudUrl;
    }

    if ("name" in req.body) patch.name = req.body.name?.trim() || user.name;
    if ("bio" in req.body) patch.bio = req.body.bio ?? user.bio;

    // ✅ use profileBackdrop consistently
    if ("profileBackdrop" in req.body) {
      patch.profileBackdrop = req.body.profileBackdrop ?? user.profileBackdrop;
    }

    // ✅ favorite films: normalize + enrich with TMDB poster_path
    if ("favoriteFilms" in req.body) {
      const fav = Array.isArray(req.body.favoriteFilms)
        ? req.body.favoriteFilms
        : safeJson(req.body.favoriteFilms, []);

      const enriched = await Promise.all(
        fav.map(async (m) => {
          // normalize id → tmdbId (always numeric)
          const tmdbId = Number(m?.tmdbId || m?.id || m);
          if (!tmdbId || Number.isNaN(tmdbId)) return null;

          // ✅ enforce clean schema: only tmdbId/title/poster_path
          if (m?.poster_path || m?.poster) {
            return {
              tmdbId,
              title: m.title || m?.original_title || "",
              poster_path: m.poster_path || m.poster,
            };
          }

          try {
            const { data } = await axios.get(
              `https://api.themoviedb.org/3/movie/${tmdbId}`,
              { params: { api_key: TMDB_API_KEY, language: "en-US" } }
            );

            return {
              tmdbId,
              title: m.title || data.title,
              poster_path: data.poster_path,
            };
          } catch (err) {
            console.warn("⚠️ TMDB fetch failed for", tmdbId, err.message);
            return { tmdbId, title: m.title || "Unknown", poster_path: null };
          }
        })
      );

      // filter nulls + dedupe by tmdbId
      const seen = new Set();
      patch.favoriteFilms = enriched
        .filter(Boolean)
        .filter((f) => {
          if (seen.has(f.tmdbId)) return false;
          seen.add(f.tmdbId);
          return true;
        });
    }

    // ✅ merge socials/connections
    if ("connections" in req.body || "socials" in req.body) {
      const incoming =
        typeof req.body.connections === "string"
          ? safeJson(req.body.connections, {})
          : req.body.connections ||
            (typeof req.body.socials === "string"
              ? safeJson(req.body.socials, {})
              : req.body.socials || {});
      patch.connections = { ...(user.connections || {}), ...(incoming || {}) };
    }

    Object.assign(user, patch);
    await user.save();

    return res.json({ message: "✅ Profile updated", user });
  } catch (err) {
    console.error("❌ Update failed:", err);
    return res.status(500).json({ error: "Server error" });
  }
});





function safeJson(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}



router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password')
      .lean();

    if (!user) return res.status(404).json({ message: 'User not found' });

    // ✅ Get custom posters from separate collection
    const customPostersDocs = await CustomPoster.find({ userId: req.params.id });
    const customPosters = {};
    customPostersDocs.forEach((doc) => {
      customPosters[doc.movieId] = doc.posterUrl;
    });

    // ✅ Get total logs (unique movies)
    const uniqueFilms = await Log.distinct('movie', { user: req.params.id });
    const totalLogs = uniqueFilms.length;

    // ✅ Get follower count
    const followerCount = await User.countDocuments({ following: req.params.id });

    // ✅ Get last 4 logs
    const recentLogs = await Log.find({ user: req.params.id })
      .sort({ createdAt: -1 })
      .limit(4)
      .select('movie title poster rating rewatch createdAt review')
      .lean();

    res.json({
      ...user,
      favoriteMovies: user.favoriteFilms || [], // ✅ Pulls from the correct field
      customPosters, // ✅ FROM database, not User model
      totalLogs,
      followerCount,
      followingCount: user.following?.length || 0,
      recentLogs,
    });
  } catch (err) {
    console.error("❌ Failed to get user profile:", err);
    res.status(500).json({ message: 'Failed to fetch user', error: err.message });
  }
});



// routes/userRoutes.js

router.get("/:id/followers", async (req, res) => {
  try {
    const followers = await User.find({ following: req.params.id }).select("username avatar");
    const user = await User.findById(req.params.id).select("username");
    res.json({ user, followers });
  } catch (err) {
    res.status(500).json({ message: "❌ Failed to fetch followers", error: err });
  }
});




// Get users that a user is following
router.get("/:id/following", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).populate("following", "username avatar");
    res.json({ user: { username: user.username }, following: user.following });
  } catch (err) {
    res.status(500).json({ message: "❌ Failed to fetch following", error: err });
  }
});

// POST /api/users/:id/notify/share
router.post('/:id/notify/share', async (req, res) => {
  try {
    const { fromUserId, movieId } = req.body;

    const recipient = await User.findById(req.params.id);
    if (!recipient) return res.status(404).json({ message: "Recipient not found" });

    const fromUser = await User.findById(fromUserId);
    if (!fromUser) return res.status(404).json({ message: "Sender not found" });

    const notif = await Notification.create({
      type: "suggest_movie", // ✅ match frontend
      message: "suggested you check out this film!", // ✅ polished
      from: fromUserId,
      to: recipient._id,
      movieId,
      read: false,
      createdAt: new Date(),
    });

    // ✅ Real-time emit
    const io = req.app.get("io");
    io.to(recipient._id.toString()).emit("notification", {
      ...notif._doc,
      from: {
        _id: fromUser._id,
        username: fromUser.username,
        avatar: fromUser.avatar,
      },
    });

    res.json({ message: "✅ Notification sent" });
  } catch (err) {
    res.status(500).json({ message: "❌ Failed to send notification", error: err.message });
  }
});

// ✅ Fast Watchlist (no TMDB calls)
// ✅ Fast Watchlist (always returns poster_path)
router.get("/:userId/watchlist", async (req, res) => {
  const { userId } = req.params;
  const sort = req.query.sort || "added";
  const order = req.query.order === "desc" ? -1 : 1;
  const genre = req.query.genre ? Number(req.query.genre) : null;

  try {
    const user = await User.findById(userId).lean();
    if (!user || !user.watchlist) {
      return res.status(404).json({ error: "User or watchlist not found" });
    }

    // Clean: only objects with tmdbId
    let movies = user.watchlist.filter((w) => typeof w === "object" && w.tmdbId);

    // 🎬 Genre filter (if you store genres locally)
    if (genre && !isNaN(genre)) {
      movies = movies.filter(
        (m) => Array.isArray(m.genres) && m.genres.some((g) => g.id === genre)
      );
    }

    // Sort
    movies.sort((a, b) => {
      if (sort === "added") return (new Date(a.addedAt) - new Date(b.addedAt)) * order;
      if (sort === "runtime") return ((a.runtime || 0) - (b.runtime || 0)) * order;
      if (sort === "rating") return ((a.vote_average || 0) - (b.vote_average || 0)) * order;
      if (sort === "release") return (new Date(a.release_date) - new Date(b.release_date)) * order;
      return (a.title || "").localeCompare(b.title || "") * order;
    });

    // 🎨 Custom posters
    const customPosters = await CustomPoster.find({
      userId,
      movieId: { $in: movies.map((m) => String(m.tmdbId)) },
    }).lean();

    const postersMap = {};
    customPosters.forEach((cp) => {
      postersMap[cp.movieId] = cp.posterUrl;
    });

    // 🔍 Enrich missing poster_path using TMDB
    let enrichedMovies = await Promise.all(
      movies.map(async (m) => {
        let poster_path = m.poster_path || null;
        let title = m.title || null;
        let release_date = m.release_date || null;

        if (!poster_path) {
          try {
            const details = await getMovieDetails(m.tmdbId);
            poster_path = details?.poster_path || null;
            title = title || details?.title || null;
            release_date = release_date || details?.release_date || null;
          } catch (err) {
            console.warn("⚠️ Failed to fetch TMDB details for", m.tmdbId);
          }
        }

        return {
          ...m,
          posterOverride: postersMap[m.tmdbId] || null,
          poster_path,
          title,
          release_date,
        };
      })
    );

    res.json(enrichedMovies);
  } catch (err) {
    console.error("❌ Failed to fetch watchlist", err);
    res.status(500).json({ error: "Could not fetch watchlist" });
  }
});







router.get('/mutuals', protect, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id).lean();
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const mutuals = await User.find({
      _id: { $in: currentUser.following },  // I am following them
      followers: req.user._id              // AND they follow me back
    }).select('username avatar');

    res.json(mutuals);
  } catch (err) {
    console.error("❌ Failed to fetch mutual followers", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// routes/userRoutes.js
router.post('/:id/remove-follower/:followerId', protect, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, {
      $pull: { followers: req.params.followerId },
    });
    await User.findByIdAndUpdate(req.params.followerId, {
      $pull: { following: req.params.id },
    });
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Failed to remove follower", err);
    res.status(500).json({ message: "Server error" });
  }
});

// PATCH /api/users/:id/language
router.patch("/:id/language", protect, async (req, res) => {
  try {
    if (String(req.user._id) !== req.params.id) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const { language } = req.body;
    const validLangs = ["en", "ar"]; // add more later
    if (!validLangs.includes(language)) {
      return res.status(400).json({ error: "Invalid language" });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { language },
      { new: true }
    );

    res.json({ message: "Language updated", user });
  } catch (err) {
    console.error("❌ Update language error:", err);
    res.status(500).json({ error: "Failed to update language" });
  }
});

// admin: force A to unfollow B
router.post("/admin/force-unfollow", protect, async (req, res) => {
  try {
    const { aId, bId } = req.body;

    await User.findByIdAndUpdate(aId, { $pull: { following: bId } });
    await User.findByIdAndUpdate(bId, { $pull: { followers: aId } });

    res.json({ message: "✅ Forced unfollow successful" });
  } catch (err) {
    console.error("❌ Force unfollow failed:", err);
    res.status(500).json({ error: "Failed to force unfollow" });
  }
});

// ✅ Admin toggle block/unblock following
router.post("/admin/block-follow/:id", protect, async (req, res) => {
  try {
    const { block } = req.body; // send { block: true } or { block: false }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.noNewFollowers = !!block; // 🚫 true = block, false = allow
    await user.save();

    res.json({
      message: `User ${user.username} is now ${
        user.noNewFollowers ? "blocked from new followers 🚫" : "open to followers ✅"
      }`,
    });
  } catch (err) {
    console.error("❌ Block follow failed:", err);
    res.status(500).json({ error: "Server error" });
  }
});


module.exports = router;

