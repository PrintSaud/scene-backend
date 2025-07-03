// routes/dailyMovie.js
const express = require("express");
const router = express.Router();
const getDailyMovie = require("../utils/dailyMovie");

router.get("/", async (req, res) => {
  const movie = await getDailyMovie();
  if (!movie) return res.status(500).json({ message: "No daily movie available" });
  res.json(movie);
});

module.exports = router;
