// utils/dailyMovie.js
const axios = require("axios");

let cachedMovie = null;
let lastFetched = null;

const TMDB_KEY = process.env.TMDB_KEY;

async function getDailyMovie() {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;

  if (cachedMovie && lastFetched && now - lastFetched < oneDay) {
    return cachedMovie;
  }

  try {
    const res = await axios.get(
      `https://api.themoviedb.org/3/trending/movie/day?api_key=${TMDB_KEY}`
    );
    const random = res.data.results[Math.floor(Math.random() * res.data.results.length)];
    cachedMovie = random;
    lastFetched = now;
    return random;
  } catch (err) {
    console.error("❌ Failed to fetch daily movie:", err.message);
    return null;
  }
}

module.exports = getDailyMovie;
