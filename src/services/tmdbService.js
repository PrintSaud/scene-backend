const axios = require('axios');
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const apiKey = process.env.TMDB_API_KEY;

if (!apiKey) {
  throw new Error('TMDB_API_KEY is missing in .env');
}

// 🔍 Search Movies
async function searchMovies(query, page = 1, language = "en-US") {
  try {
    const { data } = await axios.get(`${TMDB_BASE_URL}/search/movie`, {
      params: {
        api_key: apiKey,
        query,
        page,
        language,
      },
    });
    return data;
  } catch (err) {
    console.error(`❌ TMDB searchMovies failed:`, err.message);
    return { results: [], total_pages: 0 };
  }
}

// 🎬 Get Movie Details
async function getMovieDetails(tmdbId, language = "en-US") {
  try {
    const { data } = await axios.get(`${TMDB_BASE_URL}/movie/${tmdbId}`, {
      params: {
        api_key: apiKey,
        append_to_response: 'credits,images',
        language,
      },
    });

    if (!data?.id || !data?.title) {
      console.warn(`⚠️ Incomplete movie data for TMDB ID: ${tmdbId} (lang: ${language})`);
      return null;
    }

    return {
      ...data,
      tmdbId: data.id,
    };
  } catch (err) {
    console.error(`❌ Failed to fetch TMDB movie ${tmdbId} (lang: ${language}):`, err.message);
    return null;
  }
}

// 🔥 Trending Movies
async function getTrendingMovies(language = "en-US") {
  try {
    const { data } = await axios.get(`${TMDB_BASE_URL}/trending/movie/week`, {
      params: { api_key: apiKey, language },
    });
    return data.results || [];
  } catch (err) {
    console.error("❌ TMDB getTrendingMovies failed:", err.message);
    return [];
  }
}

// 🎭 Search People (actors, directors)
async function searchPeople(query, page = 1, language = "en-US") {
  try {
    const { data } = await axios.get(`${TMDB_BASE_URL}/search/person`, {
      params: {
        api_key: apiKey,
        query,
        page,
        language,
      },
    });
    return data;
  } catch (err) {
    console.error(`❌ TMDB searchPeople failed:`, err.message);
    return { results: [], total_pages: 0 };
  }
}

// 👤 Get Person Details (actor/director)
async function getPersonDetails(personId, language = "en-US") {
  try {
    const { data } = await axios.get(`${TMDB_BASE_URL}/person/${personId}`, {
      params: {
        api_key: apiKey,
        append_to_response: 'movie_credits,images',
        language,
      },
    });

    if (!data?.id || !data?.name) {
      console.warn(`⚠️ Incomplete person data for TMDB ID: ${personId} (lang: ${language})`);
      return null;
    }

    return {
      ...data,
      personId: data.id,
    };
  } catch (err) {
    console.error(`❌ Failed to fetch TMDB person ${personId} (lang: ${language}):`, err.message);
    return null;
  }
}

module.exports = {
  searchMovies,
  getMovieDetails,
  getTrendingMovies,
  searchPeople,
  getPersonDetails,
};
