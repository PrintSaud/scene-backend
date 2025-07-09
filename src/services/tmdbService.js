const axios = require('axios');
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const apiKey = process.env.TMDB_API_KEY;

if (!apiKey) {
  throw new Error('TMDB_API_KEY is missing in .env');
}

async function searchMovies(query, page = 1) {
  const { data } = await axios.get(`${TMDB_BASE_URL}/search/movie`, {
    params: { api_key: apiKey, query, page },
  });
  return data;
}

async function getMovieDetails(tmdbId) {
  try {
    const { data } = await axios.get(`${TMDB_BASE_URL}/movie/${tmdbId}`, {
      params: {
        api_key: apiKey,
        append_to_response: 'credits,images',
      },
    });

    if (!data?.id || !data?.title || !data?.poster_path) {
      console.warn(`⚠️ Incomplete data for TMDB ID: ${tmdbId}`);
      return null;
    }

    // 🔥 Explicitly add tmdbId
    return {
      ...data,
      tmdbId: data.id
    };
  } catch (err) {
    console.error(`❌ Failed to fetch TMDB movie ${tmdbId}:`, err.message);
    return null;
  }
}


async function getTrendingMovies() {
  const { data } = await axios.get(`${TMDB_BASE_URL}/trending/movie/week`, {
    params: { api_key: apiKey },
  });
  return data.results;
}

module.exports = {
  searchMovies,
  getMovieDetails,
  getTrendingMovies,
};
