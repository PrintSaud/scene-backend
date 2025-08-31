const express = require("express");
const router = express.Router();
const axios = require("axios");

const TMDB_API_KEY = process.env.TMDB_API_KEY;

// GET /api/tmdb/person/:id → Director/Actor details
router.get("/person/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { data } = await axios.get(`https://api.themoviedb.org/3/person/${id}`, {
      params: { api_key: TMDB_API_KEY },
    });
    res.json(data);
  } catch (err) {
    console.error("❌ Failed to fetch TMDB person:", err.message);
    res.status(500).json({ message: "❌ Failed to fetch TMDB person" });
  }
});

// GET /api/tmdb/person/:id/credits → Movie credits
router.get("/person/:id/credits", async (req, res) => {
  try {
    const { id } = req.params;
    const { data } = await axios.get(
      `https://api.themoviedb.org/3/person/${id}/movie_credits`,
      { params: { api_key: TMDB_API_KEY } }
    );
    res.json(data);
  } catch (err) {
    console.error("❌ Failed to fetch TMDB credits:", err.message);
    res.status(500).json({ message: "❌ Failed to fetch TMDB credits" });
  }
});

// ✅ NEW: GET /api/tmdb/movie/:id → Poster + details
router.get("/movie/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { data } = await axios.get(
      `https://api.themoviedb.org/3/movie/${id}`,
      { params: { api_key: TMDB_API_KEY } }
    );

    res.json({
      id: data.id,
      title: data.title,
      poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
    });
  } catch (err) {
    console.error("❌ Failed to fetch TMDB movie:", err.message);
    res.status(500).json({ message: "❌ Failed to fetch TMDB movie" });
  }
});

module.exports = router;
