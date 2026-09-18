// utils/dailyMovie.js
const axios = require("axios");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const tz = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(tz);

const ShownDailyMovie = require("../models/ShownDailyMovie");
const DailyMovieSelection = require("../models/DailyMovieSelection");

const TMDB_KEY = process.env.TMDB_KEY || process.env.TMDB_API_KEY;

const GENRE_ANIMATION = 16;
const GENRE_FAMILY = 10751;

let cachedMovie = null;
let cachedDate = null; // YYYY-MM-DD in Asia/Riyadh

// TMDB genre ids we want to exclude extra-hard (beyond API filter)

// 🎯 Candidate pool (quality-first, exclude kids/trending fluff)
const POOL_BASE = {
  "vote_average.gte": 7.5,
  "vote_count.gte": 5000,      // tougher bar to avoid inflated fresh titles
  without_genres: "16,99,10751,10755", // docs, reality, animation, family
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

async function saveDailySelection(movie, source = "random") {
  const today = todayKSA();

  await DailyMovieSelection.findOneAndUpdate(
    { date: today },
    {
      $set: {
        date: today,
        tmdbId: movie.tmdbId,
        title: movie.title,
        overview: movie.overview || "",
        poster_path: movie.poster_path || null,
        backdrop_path: movie.backdrop_path || null,
        rating: movie.rating || 0,
        votes: movie.votes || 0,
        release_date: movie.release_date || null,
        source,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );
}

function normalizeStoredMovie(stored) {
  return {
    date: stored.date,
    tmdbId: stored.tmdbId,
    title: stored.title,
    overview: stored.overview || "",
    poster_path: stored.poster_path || null,
    backdrop_path: stored.backdrop_path || null,
    rating: stored.rating || 0,
    votes: stored.votes || 0,
    release_date: stored.release_date || null,
  };
}

async function getDailyMovie({ force = false } = {}) {
  const today = todayKSA();

  if (!force && cachedMovie && cachedDate === today) {
    return cachedMovie;
  }

  if (!TMDB_KEY) {
    throw new Error("TMDB_KEY/TMDB_API_KEY missing");
  }

  if (!force) {
    const stored = await DailyMovieSelection.findOne({ date: today }).lean();

    if (stored) {
      cachedMovie = normalizeStoredMovie(stored);
      cachedDate = today;
      return cachedMovie;
    }
  }

  const chosen = await pickRandomQualityMovie();

  if (!chosen) {
    throw new Error("No suitable daily movie found");
  }

  await ShownDailyMovie.updateOne(
    { tmdbId: chosen.tmdbId },
    { $setOnInsert: { shownAt: new Date() } },
    { upsert: true }
  );

  const movie = {
    date: today,
    ...chosen,
  };

  await saveDailySelection(movie, force ? "skip" : "random");

  cachedMovie = movie;
  cachedDate = today;

  return cachedMovie;
}

async function skipDailyMovie() {
  clearDailyCache();
  return getDailyMovie({ force: true });
}

async function setDailyMovie(tmdbId) {
  if (!TMDB_KEY) {
    throw new Error("TMDB_KEY/TMDB_API_KEY missing");
  }

  const id = Number(tmdbId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid TMDB movie ID");
  }

  const { data: full } = await axios.get(
    `https://api.themoviedb.org/3/movie/${id}`,
    {
      params: {
        api_key: TMDB_KEY,
      },
    }
  );

  if (!full?.id) {
    throw new Error("Movie not found on TMDB");
  }

  const today = todayKSA();

  const movie = {
    date: today,
    tmdbId: full.id,
    title: full.title || full.original_title || "",
    overview: full.overview || "",
    poster_path: full.poster_path || null,
    backdrop_path: full.backdrop_path || null,
    rating: full.vote_average || 0,
    votes: full.vote_count || 0,
    release_date: full.release_date || null,
  };

  await ShownDailyMovie.updateOne(
    { tmdbId: full.id },
    { $setOnInsert: { shownAt: new Date() } },
    { upsert: true }
  );

  await saveDailySelection(movie, "manual");

  cachedMovie = movie;
  cachedDate = today;

  return movie;
}

function clearDailyCache() {
  cachedMovie = null;
  cachedDate = null;
}

module.exports = {
  getDailyMovie,
  skipDailyMovie,
  setDailyMovie,
  clearDailyCache,
};
