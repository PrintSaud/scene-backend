// utils/dailyMovie.js
const axios = require("axios");
const ShownDailyMovie = require("../models/ShownDailyMovie");

let cachedMovie = null;
let lastFetched = null;

const TMDB_KEY = process.env.TMDB_KEY;

async function getDailyMovie() {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;

  // ✅ If cached and not expired, return it
  if (cachedMovie && lastFetched && now - lastFetched < oneDay) {
    return cachedMovie;
  }

  try {
    // 🔥 1. Fetch trending
    const res = await axios.get(
      `https://api.themoviedb.org/3/trending/movie/day?api_key=${TMDB_KEY}`
    );

    const trending = res.data.results;

    // 🔍 2. Filter: Rating ≥ 7.5 and votes ≥ 300
    const filtered = trending.filter(
      (m) => m.vote_average >= 7.5 && m.vote_count >= 3000
    );

    // 🔒 3. Check for already shown ones
    const shown = await ShownDailyMovie.find().select("tmdbId");
    const shownIds = new Set(shown.map((s) => s.tmdbId));

    const unseen = filtered.filter((m) => !shownIds.has(m.id));

    if (unseen.length === 0) {
      console.warn("⚠️ No unseen movies left in filtered list. Returning random from all.");
      cachedMovie = filtered[0]; // fallback
      lastFetched = now;
      return cachedMovie;
    }

    // 🎯 4. Pick one randomly
    const random = unseen[Math.floor(Math.random() * unseen.length)];

    // 💾 5. Save to DB
    await ShownDailyMovie.create({ tmdbId: random.id });

    // ✅ 6. Cache it
    cachedMovie = random;
    lastFetched = now;

    return random;
  } catch (err) {
    console.error("❌ Failed to fetch daily movie:", err.message);
    return null;
  }
}

module.exports = getDailyMovie;
