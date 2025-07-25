const axios = require("axios");

const normalize = (str) =>
  str?.toLowerCase().replace(/[^\w\s]/gi, "").replace(/\s+/g, " ").trim();

/**
 * Attempts to find a valid TMDB movie match
 * @param {string} titleRaw - Raw movie title
 * @param {number} year - Release year (optional)
 * @returns {Promise<Object|null>} - Matched TMDB movie object or null
 */
const findValidTMDBMatch = async (titleRaw, year) => {
  try {
    const res = await axios.get("https://api.themoviedb.org/3/search/movie", {
      params: {
        api_key: process.env.TMDB_API_KEY,
        query: titleRaw,
        year,
      },
    });

    const results = res.data.results || [];
    if (!results.length) return null;

    const query = normalize(titleRaw);
    const movie =
      results.find(
        (m) => normalize(m.title) === query && m.release_date?.startsWith(String(year))
      ) ||
      results.find(
        (m) =>
          normalize(m.original_title) === query && m.release_date?.startsWith(String(year))
      ) ||
      results.find((m) => normalize(m.title) === query) ||
      results.find((m) => normalize(m.original_title) === query);

    return movie?.id && !isNaN(movie.id) ? movie : null;
  } catch (err) {
    console.warn("❌ TMDB search failed:", titleRaw, err.message);
    return null;
  }
};

module.exports = { findValidTMDBMatch };
