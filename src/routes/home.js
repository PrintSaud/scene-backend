const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Log = require('../models/log');
const Poll = require('../models/poll');
const axios = require('axios');

const TMDB_API_KEY = 'your_tmdb_key'; // Or from env

router.get('/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) return res.status(404).json({ message: 'User not found' });

    // 1. Logs from followed users
    const followingIds = user.following || [];

    const recentLogs = await Log.find({ user: { $in: followingIds } })
      .sort({ createdAt: -1 })
      .limit(15)
      .populate('user', 'username');

    // 2. Trending movies from TMDB
    const tmdbRes = await axios.get(`https://api.themoviedb.org/3/trending/movie/week?api_key=${TMDB_API_KEY}`);
    const trendingMovies = tmdbRes.data.results.slice(0, 10);

    // 3. Random recent poll
    const polls = await Poll.find().sort({ createdAt: -1 }).limit(5);
    const dailyPoll = polls.length > 0 ? polls[Math.floor(Math.random() * polls.length)] : null;

    res.status(200).json({
      recentLogs,
      trendingMovies,
      dailyPoll
    });

  } catch (err) {
    res.status(500).json({ message: 'Error generating feed', error: err.message });
  }
});

module.exports = router;
