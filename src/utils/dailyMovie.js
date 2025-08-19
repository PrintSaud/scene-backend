// utils/dailyMovie.js
const axios = require("axios");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const tz = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(tz);

const ShownDailyMovie = require("../models/ShownDailyMovie");

const TMDB_KEY = process.env.TMDB_KEY || process.env.TMDB_API_KEY;

let cachedMovie = null;
let cachedDate = null; // YYYY-MM-DD in Asia/Riyadh

// TMDB genre ids we want to exclude extra-hard (beyond API filter)

// 🎯 Candidate pool (quality-first, exclude kids/trending fluff)
const POOL_BASE = {
  "vote_average.gte": 7.5,
  "vote_count.gte": 5000,      // tougher bar to avoid inflated fresh titles
  without_genres: "99,10755", // docs, reality, animation, family
  include_adult: false,
  include_video: false,
  with_runtime_gte: 70,        // avoid shorts/specials
};

function todayKSA() {
  return dayjs().tz("Asia/Riyadh").format("YYYY-MM-DD");
}

function oneYearAgoKSA() {
  return dayjs().tz("Asia/Riyadh").subtract(1, "year").format("YYYY-MM-DD");
}

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

async function pickRandomQualityMovie() {
  const today = todayKSA();
  const oneYearAgo = oneYearAgoKSA();

  const SORTS = ["vote_average.desc", "popularity.desc"];
  const sort_by = SORTS[Math.floor(Math.random() * SORTS.length)];

  const base = {
    api_key: TMDB_KEY,
    sort_by,
    ...POOL_BASE,
    "primary_release_date.lte": today,
    "primary_release_date.gte": "1970-01-01",
  };

  const ATTEMPTS = 8;
  const MAX_PAGE = 60;

  const shown = await ShownDailyMovie.find().select("tmdbId");
  const shownIds = new Set(shown.map((s) => s.tmdbId));

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const page = Math.floor(Math.random() * MAX_PAGE) + 1;
    const { data } = await axios.get("https://api.themoviedb.org/3/discover/movie", {
      params: { ...base, page },
    });

    const results = Array.isArray(data?.results) ? data.results : [];
    if (!results.length) continue;

    const shuffled = shuffle(results);

    for (const m of shuffled) {
      if (!m?.id || shownIds.has(m.id)) continue;
      if (!m.overview) continue;
      if (!m.poster_path || !m.backdrop_path) continue;

      // Extra local guards:
      const releaseDate = m.release_date || m.primary_release_date || "";
      if (releaseDate && releaseDate > oneYearAgo) continue;

      const genres = Array.isArray(m.genre_ids) ? m.genre_ids : [];
      if (genres.includes(GENRE_ANIMATION) || genres.includes(GENRE_FAMILY)) continue;

      if ((m.vote_count || 0) < 5000) continue;

      // 🔒 Double-check full movie details to avoid unreleased placeholders
      try {
        const { data: full } = await axios.get(
          `https://api.themoviedb.org/3/movie/${m.id}`,
          { params: { api_key: TMDB_KEY } }
        );

        if (full.status !== "Released") continue; // 👈 block Superman-style junk
        if ((full.vote_count || 0) < 5000) continue;

        return {
          tmdbId: m.id,
          title: full.title || full.original_title,
          overview: full.overview,
          poster_path: full.poster_path,
          backdrop_path: full.backdrop_path,
          rating: full.vote_average,
          votes: full.vote_count,
          release_date: full.release_date || null,
        };
      } catch {
        continue;
      }
    }
  }

  return null;
}

async function getDailyMovie({ force = false } = {}) {
  const today = todayKSA();

  if (!force && cachedMovie && cachedDate === today) {
    return cachedMovie;
  }

  if (!TMDB_KEY) throw new Error("TMDB_KEY/TMDB_API_KEY missing");

  const chosen = await pickRandomQualityMovie();
  if (!chosen) throw new Error("No suitable daily movie found");

  await ShownDailyMovie.updateOne(
    { tmdbId: chosen.tmdbId },
    { $setOnInsert: { shownAt: new Date() } },
    { upsert: true }
  );

  cachedMovie = { date: today, ...chosen };
  cachedDate = today;
  return cachedMovie;
}

function clearDailyCache() {
  cachedMovie = null;
  cachedDate = null;
}

module.exports = { getDailyMovie, clearDailyCache };
