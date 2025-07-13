// src/routes/user.js

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/user');
const Log = require("../models/log"); // ✅ Add this import
const { getMovieDetails } = require("../services/tmdbService"); // ✅ Ad
const protect = require("../middleware/authMiddleware");  // 🔔 REQUIRED 🔔

// GET all users
router.get('/', async (req, res) => {
  try {
    const users = await User.find({}, 'username avatar'); // only return public info
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

// follow 
router.post('/:userId/follow/:targetId', async (req, res) => {
  try {
    console.log("🔔 Follow API hit", {
      userId: req.params.userId,
      targetId: req.params.targetId
    });

    const user = await User.findById(req.params.userId);
    const targetUser = await User.findById(req.params.targetId);

    if (!user || !targetUser) {
      console.log("❌ User or target user not found");
      return res.status(404).json({ error: 'User not found' });
    }

    const isFollowing = user.following.includes(req.params.targetId);
    console.log("👉 isFollowing:", isFollowing);

    if (isFollowing) {
      user.following.pull(req.params.targetId);
      targetUser.followers.pull(req.params.userId);
    } else {
      user.following.push(req.params.targetId);
      targetUser.followers.push(req.params.userId);

      // 🛡️ Safe guard to ensure notifications array exists
      if (!Array.isArray(targetUser.notifications)) {
        targetUser.notifications = [];
      }

      // 🛎️ Notification block
      targetUser.notifications.unshift({
        type: "follow",
        message: `@${user.username} just followed you`,
        fromUser: user._id,
        createdAt: new Date(),
        read: false
      });
    }

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

  // src/routes/user.js (or make a new controller if you prefer)
router.post('/:id/custom-poster', async (req, res) => {
    const { movieId, newPoster } = req.body;
  
    try {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ message: 'User not found' });
  
      // Optional: Check if movieId is actually in their logged/favs/lists
      // (We'll add that logic later if you want)
  
      user.customPosters.set(movieId, newPoster);
      await user.save();
  
      res.status(200).json({ message: 'Poster updated successfully' });
    } catch (err) {
      res.status(500).json({ message: 'Something went wrong', error: err.message });
    }
  });

  router.get('/:id/custom-poster/:movieId', async (req, res) => {
    try {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ message: 'User not found' });
  
      const poster = user.customPosters.get(req.params.movieId) || null;
  
      res.status(200).json({ customPoster: poster });
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

// Get all favorites
router.get('/:userId/favorites', async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findById(userId).populate('favorites');
    res.status(200).json(user.favorites);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/users/:id — update user profile
router.patch('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.name = req.body.name || user.name;
    user.bio = req.body.bio || user.bio;
    user.avatar = req.body.avatar || user.avatar;
    user.profileBackdrop = req.body.backdrop || user.profileBackdrop;
    user.favoriteMovies = req.body.favoriteMovies || user.favoriteMovies;

    await user.save();

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        name: user.name,
        bio: user.bio,
        avatar: user.avatar,
        backdrop: user.profileBackdrop,
        favoriteMovies: user.favoriteMovies,
      },
    });
  } catch (err) {
    console.error("❌ Update failed:", err.message);
    res.status(500).json({ error: 'Server error' });
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

// ✅ Suggest a movie to mutual friends
router.post('/:id/suggest/:movieId', async (req, res) => {
  const { friends, movieTitle } = req.body;

  if (!Array.isArray(friends) || friends.length === 0) {
    return res.status(400).json({ message: "❌ No friends selected." });
  }

  try {
    const sender = await User.findById(req.params.id);
    if (!sender) return res.status(404).json({ message: "Sender not found" });

    for (let friendId of friends) {
      const friend = await User.findById(friendId);
      if (!friend) continue;

      // Add a notification
      friend.notifications.unshift({
        type: "suggestion",
        message: `🎬 @${sender.username} suggested you check out "${movieTitle}"!`,
        fromUser: sender._id,
        createdAt: new Date(),
        read: false,
      });

      await friend.save();
    }

    res.status(200).json({ message: `✅ Suggested to ${friends.length} friend(s)!` });
  } catch (err) {
    console.error("❌ Suggestion failed:", err);
    res.status(500).json({ message: "Something went wrong", error: err.message });
  }
});

// POST /api/users/:id/notify/share
router.post('/:id/notify/share', async (req, res) => {
  try {
    const { fromUserId, movieTitle } = req.body;

    const recipient = await User.findById(req.params.id);
    if (!recipient) return res.status(404).json({ message: "Recipient not found" });

    const fromUser = await User.findById(fromUserId);
    if (!fromUser) return res.status(404).json({ message: "Sender not found" });

    const message = `@${fromUser.username} suggested you check out "${movieTitle}"`;

    recipient.notifications.unshift({
      type: "share",
      message,
      fromUser: fromUserId,
    });

    await recipient.save();
    res.json({ message: "✅ Notification sent" });
  } catch (err) {
    res.status(500).json({ message: "❌ Failed to send notification", error: err.message });
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

// GET a user's watchlist
router.get('/:userId/watchlist', async (req, res) => {
  const { userId } = req.params;
  const sort = req.query.sort || "title";
  const order = req.query.order === "desc" ? -1 : 1;

  try {
    const user = await User.findById(userId);
    if (!user || !user.watchlist)
      return res.status(404).json({ error: "User or watchlist not found" });

    let movieDetails = await Promise.all(
      user.watchlist.map(async (tmdbId) => {
        const movie = await getMovieDetails(tmdbId);
        return movie && movie.id && movie.poster_path
          ? { ...movie, tmdbId: movie.id }
          : null;
      })
    );

    movieDetails = movieDetails.filter(Boolean);

    movieDetails.sort((a, b) => {
      if (sort === "runtime") return (a.runtime - b.runtime) * order;
      if (sort === "rating") return ((a.vote_average || 0) - (b.vote_average || 0)) * order;
      if (sort === "release")
        return (new Date(a.release_date) - new Date(b.release_date)) * order;
      return (a.title || "").localeCompare(b.title || "") * order;
    });

    res.json(movieDetails);
  } catch (err) {
    console.error("❌ Failed to fetch watchlist", err);
    res.status(500).json({ error: "Could not fetch watchlist" });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password')
      .lean();

    const totalLogs = await Log.countDocuments({ user: req.params.id });
    const followerCount = await User.countDocuments({ following: req.params.id });

    res.json({
      ...user,
      totalLogs,
      followerCount,
      followingCount: user.following?.length || 0,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch user', error: err.message });
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

router.get('/mutuals', protect, async (req, res) => {
  try {
    console.log("🔎 /mutuals hit by user:", req.user);
    const currentUser = await User.findById(req.user._id);
    if (!currentUser) {
      console.log("❌ currentUser not found for id:", req.user._id);
      return res.status(404).json({ message: "User not found" });
    }

    console.log("👉 currentUser.following:", currentUser.following);
    const mutuals = await User.find({
      _id: { $in: currentUser.following },
      followers: currentUser._id,
    }).select('username avatar');

    console.log("✅ Found mutuals:", mutuals.length);
    res.json(mutuals);
  } catch (err) {
    console.error("❌ Failed to fetch mutuals:", err.message, err.stack);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});






module.exports = router;

