const express = require("express");
const router = express.Router();
const getDailyMovie = require("../utils/dailyMovie");

router.get("/", async (req, res) => {
  const movie = await getDailyMovie();
  if (!movie) return res.status(500).json({ message: "Failed to fetch daily movie" });

  res.json({
    id: movie.id,
    title: movie.title,
    overview: movie.overview,
    poster: `https://image.tmdb.org/t/p/w500${movie.poster_path}`
  });
});

module.exports = router;
