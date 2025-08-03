// utils/dailyMovie.js
const axios = require("axios");
const ShownDailyMovie = require("../models/ShownDailyMovie");

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
    // 🎯 Step 1: Build discover query
    const discoverParams = {
      api_key: TMDB_KEY,
      sort_by: "popularity.desc", // Or "vote_average.desc"
      vote_average_gte: 7.5,
      vote_count_gte: 500,
      language: "en-US",
      page: Math.floor(Math.random() * 20) + 1, // Randomize page (1–20)
    };

    const query = Object.entries(discoverParams)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");

    const url = `https://api.themoviedb.org/3/discover/movie?${query}`;

    // 📡 Step 2: Fetch movies
    const res = await axios.get(url);
    const allResults = res.data.results;

    // 💾 Step 3: Exclude already shown
    const shown = await ShownDailyMovie.find().select("tmdbId");
    const shownIds = new Set(shown.map((s) => s.tmdbId));
    const unseen = allResults.filter((m) => !shownIds.has(m.id));

    if (unseen.length === 0) {
      console.warn("⚠️ No unseen movies left in this page. Picking first from full list.");
      cachedMovie = allResults[0]; // fallback
    } else {
      cachedMovie = unseen[Math.floor(Math.random() * unseen.length)];
      await ShownDailyMovie.create({ tmdbId: cachedMovie.id });
    }

    lastFetched = now;
    return cachedMovie;
  } catch (err) {
    console.error("❌ Failed to fetch daily movie:", err.message);
    return null;
  }
}


module.exports = getDailyMovie;
