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

// get all users
router.get('/', async (req, res) => {
  try {
    const users = await User.find({}, 'username avatar following followers');
    console.log("🔥 USERS RETURNED FROM /api/users:", users);
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
router.post('/:userId/follow/:targetId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    const targetUser = await User.findById(req.params.targetId);

    if (!user || !targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isFollowing = user.following.includes(req.params.targetId);

    if (isFollowing) {
      user.following.pull(req.params.targetId);
      targetUser.followers.pull(req.params.userId);
    } else {
      user.following.push(req.params.targetId);
      targetUser.followers.push(req.params.userId);

      await Notification.create({
        type: "follow",
        message: `@${user.username} just followed you`,
        from: user._id,
        to: targetUser._id,
        read: false,
        createdAt: new Date(),
      });
    }

    // ✅ Clean corrupted watchlist entries before save
    user.watchlist = (user.watchlist || []).filter(item => item && typeof item === 'object' && typeof item.tmdbId === 'number');
    targetUser.watchlist = (targetUser.watchlist || []).filter(item => item && typeof item === 'object' && typeof item.tmdbId === 'number');

    await user.save();
    await targetUser.save();

    res.status(200).json({
      following: !isFollowing,
      message: isFollowing ? 'Unfollowed user' : 'Now following user'
    });
  } catch (err) {
    console.error("❌ Failed to toggle follow:", err);
    res.status(500).json({ error: 'Failed to toggle follow', details: err.message });
  }
});





router.post('/:userId/favorites/:movieId', async (req, res) => {
    const { userId, movieId } = req.params;
  
    try {
      const tmdbId = parseInt(movieId);
      const user = await User.findById(userId);
  
      if (!user.favorites.includes(tmdbId)) {
        user.favorites.push(tmdbId);
        await user.save();
      }
  
      res.status(200).json({ message: 'TMDB movie added to favorites' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
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

// Remove from favorites
router.delete('/:userId/favorites/:movieId', async (req, res) => {
  const { userId, movieId } = req.params;

  try {
    const user = await User.findById(userId);
    user.favorites = user.favorites.filter(id => id.toString() !== movieId);
    await user.save();
    res.status(200).json({ message: 'Movie removed from favorites' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:userId/favorites', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.status(200).json({ favorites: user.favorites || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/users/:id — update user profile
router.patch('/:id', upload.single("avatar"), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (req.file) {
      const cloudUrl = await uploadToCloudinary(req.file.buffer, "scene/avatars");
      user.avatar = cloudUrl;
    }

    user.name = req.body.name || user.name;
    user.bio = req.body.bio || user.bio;
    user.profileBackdrop = req.body.backdrop || user.profileBackdrop;
    user.favoriteFilms = req.body.favoriteFilms || user.favoriteFilms;

    if (req.body.socials) {
      user.socials = {
        ...user.socials,
        ...req.body.socials,
      };
    }

    await user.save();

    res.json({ message: "✅ Profile updated", user });
  } catch (err) {
    console.error("❌ Update failed:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

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

    await Notification.create({
      type: "suggest_movie", // ✅ match frontend
      message: "suggested you check out this film!", // ✅ polished
      from: fromUserId,
      to: recipient._id,
      movieId,
      read: false,
      createdAt: new Date(),
    });

    res.json({ message: "✅ Notification sent" });
  } catch (err) {
    res.status(500).json({ message: "❌ Failed to send notification", error: err.message });
  }
});

// POST /api/logs/:id/share → share a review with selected users
router.post("/:id/share", protect, async (req, res) => {
  const { recipients } = req.body; // Array of user IDs
  const logId = req.params.id;
  const userId = req.user._id;

  try {
    const log = await Log.findById(logId);
    if (!log) return res.status(404).json({ message: "Review not found" });

    await Promise.all(
      recipients.map(async (rid) => {
        await Notification.create({
          type: "share-review", // ✅ this must match frontend logic
          message: "suggested you to check out this review!",
          from: userId,
          to: rid,
          reviewId: log._id,
          movieId: log.tmdbId || log.movie?.id, // optional: for fallback nav
          read: false,
          createdAt: new Date(),
        });        
      })
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Failed to share review:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});



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

router.get('/:userId/watchlist', async (req, res) => {
  const { userId } = req.params;
  const sort = req.query.sort || "title";
  const order = req.query.order === "desc" ? -1 : 1;
  const genre = req.query.genre ? Number(req.query.genre) : null;

  try {
    const user = await User.findById(userId);
    if (!user || !user.watchlist)
      return res.status(404).json({ error: "User or watchlist not found" });

    let movieDetails = await Promise.all(
      user.watchlist.map(async (item) => {
        let tmdbId, addedAt;

        if (typeof item === "object" && item.tmdbId) {
          tmdbId = item.tmdbId;
          addedAt = item.addedAt || new Date(0);
        } else {
          tmdbId = item;
          addedAt = new Date(0);
        }

        const movie = await getMovieDetails(tmdbId);
        if (!movie || !movie.id) return null;

        const customPoster = await CustomPoster.findOne({
          userId: userId,
          movieId: { $in: [tmdbId, String(tmdbId)] }
        });

        const posterOverride = customPoster
          ? customPoster.posterUrl
          : movie.poster_path
          ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
          : "/default-poster.jpg";

        return {
          ...movie,
          posterOverride,
          tmdbId: movie.id,
          addedAt
        };
      })
    );

    movieDetails = movieDetails.filter(Boolean);

    // 🔥 Genre filtering here:
    if (genre && !isNaN(genre)) {
      movieDetails = movieDetails.filter(movie =>
        Array.isArray(movie.genres) &&
        movie.genres.some(g => g.id === genre)
      );
    }

    movieDetails.sort((a, b) => {
      if (sort === "added") return (new Date(a.addedAt) - new Date(b.addedAt)) * order;
      if (sort === "runtime") return (a.runtime - b.runtime) * order;
      if (sort === "rating") return ((a.vote_average || 0) - (b.vote_average || 0)) * order;
      if (sort === "release") return (new Date(a.release_date) - new Date(b.release_date)) * order;
      return (a.title || "").localeCompare(b.title || "") * order;
    });

    res.json(movieDetails);
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


module.exports = router;

