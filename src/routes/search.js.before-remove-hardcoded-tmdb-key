const express = require('express');
const router = express.Router();
const User = require('../models/user');
const List = require('../models/list');
const axios = require('axios');

// ✅ Replace with process.env or service config later
const TMDB_API_KEY = '859e517235247e4dab5a5b8d7a330527';

router.get('/', async (req, res) => {
  const query = req.query.q;
  const type = req.query.type || "all";

  if (!query) return res.status(400).json({ message: 'Search query is required' });

  try {
    // 🧠 1. Local Users
    const usersPromise = ["all", "users", "user"].includes(type)
      ? User.find({ username: { $regex: query, $options: "i" } }).limit(5)
      : Promise.resolve([]);

    // 🍿 2. TMDB Movies
    const tmdbMoviePromise = ["all", "films", "movies"].includes(type)
      ? axios.get(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${query}`)
      : Promise.resolve({ data: { results: [] } });

    // 🎭 3. TMDB People
    const tmdbPersonPromise = ["all", "people", "person"].includes(type)
      ? axios.get(`https://api.themoviedb.org/3/search/person?api_key=${TMDB_API_KEY}&query=${query}`)
      : Promise.resolve({ data: { results: [] } });

    // 🗂️ 4. Local Lists (🔥 now populated with usernames)
    const listPromise = ["all", "lists", "list"].includes(type)
      ? List.find({
          title: { $regex: query, $options: "i" },
          isPrivate: false,
        })
          .limit(10)
          .populate("user", "username")
      : Promise.resolve([]);

    // 🚀 Execute in parallel
    const [users, moviesRes, peopleRes, lists] = await Promise.all([
      usersPromise,
      tmdbMoviePromise,
      tmdbPersonPromise,
      listPromise,
    ]);

    res.status(200).json({
      users,
      movies: moviesRes.data.results.slice(0, 5),
      people: peopleRes.data.results.slice(0, 5),
      lists,
    });
  } catch (err) {
    console.error("❌ Search failed", err);
    res.status(500).json({ message: "Search failed", error: err.message });
  }
});

module.exports = router;
