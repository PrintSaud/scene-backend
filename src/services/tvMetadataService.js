// src/services/tvMetadataService.js

const axios = require("axios");

const Show = require("../models/showModel");
const Season = require("../models/seasonModel");
const Episode = require("../models/episodeModel");

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_API_KEY = process.env.TMDB_API_KEY;

if (!TMDB_API_KEY) {
  throw new Error("TMDB_API_KEY is missing in .env");
}

// ======================================================
// Shared constants
// ======================================================

const SHOW_APPEND_TO_RESPONSE = [
  "aggregate_credits",
  "credits",
  "videos",
  "images",
  "recommendations",
  "similar",
  "watch/providers",
  "external_ids",
  "keywords",
  "translations",
].join(",");

const SEASON_APPEND_TO_RESPONSE = [
  "aggregate_credits",
  "credits",
  "videos",
  "images",
  "translations",
].join(",");

const EPISODE_APPEND_TO_RESPONSE = [
  "credits",
  "videos",
  "images",
  "translations",
  "external_ids",
].join(",");

// ======================================================
// Basic helpers
// ======================================================

function parsePositiveInteger(value) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function parseSeasonNumber(value) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function parseEpisodeNumber(value) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

function normalizeString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function normalizeNullableNumber(value) {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function normalizeNonNegativeNumber(value, fallback = 0) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function isEpisodeAired(episode, now = new Date()) {
  const airDate = normalizeDate(
    episode?.air_date || episode?.airDate
  );

  if (!airDate) {
    return false;
  }

  return airDate.getTime() <= now.getTime();
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [
    ...new Set(
      values
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    ),
  ];
}

function uniqueNumbers(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [
    ...new Set(
      values
        .map((value) => Number(value))
        .filter(Number.isFinite)
    ),
  ];
}

function extractYear(dateValue) {
  const date = normalizeDate(dateValue);

  if (!date) {
    return null;
  }

  return date.getUTCFullYear();
}

// ======================================================
// TMDB request helper
// ======================================================

async function tmdbGet(
  path,
  {
    language = "en-US",
    params = {},
    timeout = 15000,
  } = {}
) {
  try {
    const response = await axios.get(
      `${TMDB_BASE_URL}${path}`,
      {
        timeout,

        params: {
          api_key: TMDB_API_KEY,
          language,
          ...params,
        },
      }
    );

    return response.data;
  } catch (error) {
    const status =
      error.response?.status || null;

    const message =
      error.response?.data?.status_message ||
      error.message;

    console.error(
      `❌ TMDB request failed: ${path}`,
      {
        status,
        message,
      }
    );

    if (status === 404) {
      return null;
    }

    throw error;
  }
}

// ======================================================
// Embedded-data formatters
// ======================================================

function formatNetwork(network) {
  return {
    tmdbId:
      normalizeNullableNumber(network?.id),

    name:
      normalizeString(network?.name),

    logoPath:
      normalizeString(network?.logo_path),

    originCountry:
      normalizeString(network?.origin_country),
  };
}

function formatCreator(creator) {
  return {
    tmdbId:
      normalizeNullableNumber(creator?.id),

    name:
      normalizeString(creator?.name),

    profilePath:
      normalizeString(creator?.profile_path),
  };
}

function formatProductionCompany(company) {
  return {
    tmdbId:
      normalizeNullableNumber(company?.id),

    name:
      normalizeString(company?.name),

    logoPath:
      normalizeString(company?.logo_path),

    originCountry:
      normalizeString(company?.origin_country),
  };
}

function formatSpokenLanguage(language) {
  return {
    iso6391:
      normalizeString(language?.iso_639_1),

    englishName:
      normalizeString(language?.english_name),

    name:
      normalizeString(language?.name),
  };
}

function formatEpisodeSummary(episode) {
  if (!episode?.id) {
    return null;
  }

  return {
    tmdbId:
      normalizeNullableNumber(episode.id),

    name:
      normalizeString(episode.name),

    overview:
      normalizeString(episode.overview),

    seasonNumber:
      Number.isInteger(
        Number(episode.season_number)
      )
        ? Number(episode.season_number)
        : null,

    episodeNumber:
      Number.isInteger(
        Number(episode.episode_number)
      )
        ? Number(episode.episode_number)
        : null,

    airDate:
      normalizeDate(episode.air_date),

    runtime:
      normalizeNullableNumber(episode.runtime),

    stillPath:
      normalizeString(episode.still_path),

    voteAverage:
      normalizeNonNegativeNumber(
        episode.vote_average
      ),

    voteCount:
      normalizeNonNegativeNumber(
        episode.vote_count
      ),
  };
}

function formatCrewMember(member) {
  return {
    tmdbId:
      normalizeNullableNumber(member?.id),

    creditId:
      normalizeString(member?.credit_id),

    name:
      normalizeString(member?.name),

    nameAr: "",

    job:
      normalizeString(member?.job),

    department:
      normalizeString(member?.department),

    profilePath:
      normalizeString(member?.profile_path),
  };
}

function formatGuestStar(member) {
  return {
    tmdbId:
      normalizeNullableNumber(member?.id),

    creditId:
      normalizeString(member?.credit_id),

    name:
      normalizeString(member?.name),

    nameAr: "",

    character:
      normalizeString(member?.character),

    characterAr: "",

    order:
      normalizeNonNegativeNumber(
        member?.order
      ),

    profilePath:
      normalizeString(member?.profile_path),
  };
}

// ======================================================
// Translation helpers
// ======================================================

function findTranslation(
  translations,
  {
    iso6391,
    iso31661,
  }
) {
  if (!Array.isArray(translations)) {
    return null;
  }

  return (
    translations.find((translation) => {
      const languageMatches =
        translation?.iso_639_1 === iso6391;

      const countryMatches =
        !iso31661 ||
        translation?.iso_3166_1 === iso31661;

      return languageMatches && countryMatches;
    }) ||
    translations.find(
      (translation) =>
        translation?.iso_639_1 === iso6391
    ) ||
    null
  );
}

function getArabicShowTranslation(details) {
  const translations =
    details?.translations?.translations;

  const translation = findTranslation(
    translations,
    {
      iso6391: "ar",
      iso31661: "SA",
    }
  );

  return {
    name:
      normalizeString(
        translation?.data?.name
      ),

    overview:
      normalizeString(
        translation?.data?.overview
      ),

    tagline:
      normalizeString(
        translation?.data?.tagline
      ),
  };
}

function getArabicSeasonTranslation(details) {
  const translations =
    details?.translations?.translations;

  const translation = findTranslation(
    translations,
    {
      iso6391: "ar",
      iso31661: "SA",
    }
  );

  return {
    name:
      normalizeString(
        translation?.data?.name
      ),

    overview:
      normalizeString(
        translation?.data?.overview
      ),
  };
}

function getArabicEpisodeTranslation(details) {
  const translations =
    details?.translations?.translations;

  const translation = findTranslation(
    translations,
    {
      iso6391: "ar",
      iso31661: "SA",
    }
  );

  return {
    name:
      normalizeString(
        translation?.data?.name
      ),

    overview:
      normalizeString(
        translation?.data?.overview
      ),
  };
}

// ======================================================
// Show searching and trending
// ======================================================

async function searchTVShows(
  query,
  page = 1,
  language = "en-US"
) {
  const normalizedQuery =
    normalizeString(query).slice(0, 150);

  if (!normalizedQuery) {
    return {
      page: 1,
      results: [],
      total_pages: 0,
      total_results: 0,
    };
  }

  const safePage =
    Number.isInteger(Number(page)) &&
    Number(page) > 0
      ? Math.min(Number(page), 500)
      : 1;

  const data = await tmdbGet(
    "/search/tv",
    {
      language,

      params: {
        query: normalizedQuery,
        page: safePage,
        include_adult: false,
      },
    }
  );

  return (
    data || {
      page: safePage,
      results: [],
      total_pages: 0,
      total_results: 0,
    }
  );
}

async function getTrendingTVShows(
  language = "en-US",
  timeWindow = "week"
) {
  const safeWindow =
    timeWindow === "day"
      ? "day"
      : "week";

  const data = await tmdbGet(
    `/trending/tv/${safeWindow}`,
    {
      language,
    }
  );

  return Array.isArray(data?.results)
    ? data.results
    : [];
}

// ======================================================
// Raw TMDB show data
// ======================================================

async function getTVShowDetails(
  showTmdbId,
  language = "en-US"
) {
  const parsedShowId =
    parsePositiveInteger(showTmdbId);

  if (!parsedShowId) {
    return null;
  }

  const data = await tmdbGet(
    `/tv/${parsedShowId}`,
    {
      language,

      params: {
        append_to_response:
          SHOW_APPEND_TO_RESPONSE,

        include_image_language:
          "en,ar,null",
      },
    }
  );

  if (!data?.id || !data?.name) {
    return null;
  }

  return data;
}

// ======================================================
// Show synchronization
// ======================================================

async function syncShowFromTMDB(
  showTmdbId,
  {
    force = false,
    maxAgeMinutes = 360,
  } = {}
) {
  const parsedShowId =
    parsePositiveInteger(showTmdbId);

  if (!parsedShowId) {
    throw new Error("Invalid TMDB show ID");
  }

  const existingShow =
    await Show.findOne({
      tmdbId: parsedShowId,
    });

  if (
    existingShow &&
    !force &&
    existingShow.lastSyncedAt
  ) {
    const ageMs =
      Date.now() -
      new Date(
        existingShow.lastSyncedAt
      ).getTime();

    const maxAgeMs =
      Math.max(1, maxAgeMinutes) *
      60 *
      1000;

    if (ageMs < maxAgeMs) {
      return existingShow;
    }
  }

  const details = await getTVShowDetails(
    parsedShowId,
    "en-US"
  );

  if (!details) {
    return null;
  }

  const arabic =
    getArabicShowTranslation(details);

  const aliases = uniqueStrings([
    details.name,
    details.original_name,
    arabic.name,
  ]);

  const genres = Array.isArray(
    details.genres
  )
    ? details.genres
        .map((genre) =>
          normalizeString(genre?.name)
        )
        .filter(Boolean)
    : [];

  const genreIds = Array.isArray(
    details.genres
  )
    ? details.genres
        .map((genre) =>
          normalizeNullableNumber(genre?.id)
        )
        .filter(
          (value) => value !== null
        )
    : [];

  const keywordResults =
    details.keywords?.results ||
    details.keywords?.keywords ||
    [];

  const keywords = Array.isArray(
    keywordResults
  )
    ? keywordResults
        .map((keyword) =>
          normalizeString(keyword?.name)
        )
        .filter(Boolean)
    : [];

  const episodeRunTime = uniqueNumbers(
    details.episode_run_time
  ).filter((runtime) => runtime > 0);

  const averageRuntime =
    episodeRunTime.length > 0
      ? Math.round(
          episodeRunTime.reduce(
            (total, runtime) =>
              total + runtime,
            0
          ) / episodeRunTime.length
        )
      : null;

  const update = {
    tmdbId: parsedShowId,

    name:
      normalizeString(details.name) ||
      "Untitled Show",

    originalName:
      normalizeString(
        details.original_name
      ),

    nameAr:
      arabic.name,

    searchAliases:
      aliases,

    tagline:
      normalizeString(details.tagline),

    overview:
      normalizeString(details.overview),

    overviewAr:
      arabic.overview,

    posterPath:
      normalizeString(
        details.poster_path
      ),

    backdropPath:
      normalizeString(
        details.backdrop_path
      ),

    firstAirDate:
      normalizeDate(
        details.first_air_date
      ),

    lastAirDate:
      normalizeDate(
        details.last_air_date
      ),

    status:
      normalizeString(details.status),

    type:
      normalizeString(details.type),

    originalLanguage:
      normalizeString(
        details.original_language
      ),

    originCountry:
      uniqueStrings(
        details.origin_country
      ),

    spokenLanguages:
      Array.isArray(
        details.spoken_languages
      )
        ? details.spoken_languages.map(
            formatSpokenLanguage
          )
        : [],

    genres,
    genreIds,
    keywords,

    networks:
      Array.isArray(details.networks)
        ? details.networks.map(
            formatNetwork
          )
        : [],

    creators:
      Array.isArray(
        details.created_by
      )
        ? details.created_by.map(
            formatCreator
          )
        : [],

    productionCompanies:
      Array.isArray(
        details.production_companies
      )
        ? details.production_companies.map(
            formatProductionCompany
          )
        : [],

    numberOfSeasons:
      normalizeNonNegativeNumber(
        details.number_of_seasons
      ),

    numberOfEpisodes:
      normalizeNonNegativeNumber(
        details.number_of_episodes
      ),

    episodeRunTime,
    averageRuntime,

    inProduction:
      details.in_production === true,

    adult:
      details.adult === true,

    popularity:
      normalizeNonNegativeNumber(
        details.popularity
      ),

    voteAverage:
      Math.min(
        10,
        normalizeNonNegativeNumber(
          details.vote_average
        )
      ),

    voteCount:
      normalizeNonNegativeNumber(
        details.vote_count
      ),

    homepage:
      normalizeString(details.homepage),

    externalIds: {
      imdbId:
        normalizeString(
          details.external_ids?.imdb_id
        ),

      tvdbId:
        normalizeNullableNumber(
          details.external_ids?.tvdb_id
        ),

      wikidataId:
        normalizeString(
          details.external_ids
            ?.wikidata_id
        ),
    },

    lastEpisodeToAir:
      formatEpisodeSummary(
        details.last_episode_to_air
      ),

    nextEpisodeToAir:
      formatEpisodeSummary(
        details.next_episode_to_air
      ),

    lastSyncedAt:
      new Date(),
  };

  const show =
    await Show.findOneAndUpdate(
      {
        tmdbId: parsedShowId,
      },
      {
        $set: update,
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      }
    );

  return show;
}

// ======================================================
// Raw TMDB season data
// ======================================================

async function getTVSeasonDetails(
  showTmdbId,
  seasonNumber,
  language = "en-US"
) {
  const parsedShowId =
    parsePositiveInteger(showTmdbId);

  const parsedSeasonNumber =
    parseSeasonNumber(seasonNumber);

  if (
    !parsedShowId ||
    parsedSeasonNumber === null
  ) {
    return null;
  }

  const data = await tmdbGet(
    `/tv/${parsedShowId}/season/${parsedSeasonNumber}`,
    {
      language,

      params: {
        append_to_response:
          SEASON_APPEND_TO_RESPONSE,

        include_image_language:
          "en,ar,null",
      },
    }
  );

  if (!data?.id) {
    return null;
  }

  return data;
}

// ======================================================
// Season synchronization
// ======================================================

async function syncSeasonFromTMDB(
  showTmdbId,
  seasonNumber,
  {
    force = false,
    maxAgeMinutes = 360,
    syncEpisodes = true,
  } = {}
) {
  const parsedShowId =
    parsePositiveInteger(showTmdbId);

  const parsedSeasonNumber =
    parseSeasonNumber(seasonNumber);

  if (
    !parsedShowId ||
    parsedSeasonNumber === null
  ) {
    throw new Error(
      "Invalid show or season number"
    );
  }

  const show =
    await syncShowFromTMDB(
      parsedShowId,
      {
        force: false,
        maxAgeMinutes,
      }
    );

  if (!show) {
    return null;
  }

  const existingSeason =
    await Season.findOne({
      showTmdbId: parsedShowId,
      seasonNumber:
        parsedSeasonNumber,
    });

  if (
    existingSeason &&
    !force &&
    existingSeason.lastSyncedAt
  ) {
    const ageMs =
      Date.now() -
      new Date(
        existingSeason.lastSyncedAt
      ).getTime();

    const maxAgeMs =
      Math.max(1, maxAgeMinutes) *
      60 *
      1000;

    if (ageMs < maxAgeMs) {
      return existingSeason;
    }
  }

  const details =
    await getTVSeasonDetails(
      parsedShowId,
      parsedSeasonNumber,
      "en-US"
    );

  if (!details) {
    return null;
  }

  const arabic =
    getArabicSeasonTranslation(details);

  const episodes = Array.isArray(
    details.episodes
  )
    ? details.episodes
    : [];

  const now = new Date();

  const airedEpisodes =
    episodes.filter((episode) =>
      isEpisodeAired(episode, now)
    );

  const airedRuntimeMinutes =
    airedEpisodes.reduce(
      (total, episode) => {
        const runtime = Number(
          episode?.runtime
        );

        return (
          total +
          (
            Number.isFinite(runtime) &&
            runtime > 0
              ? runtime
              : 0
          )
        );
      },
      0
    );

  const season =
    await Season.findOneAndUpdate(
      {
        showTmdbId: parsedShowId,

        seasonNumber:
          parsedSeasonNumber,
      },
      {
        $set: {
          show:
            show._id,

          showTmdbId:
            parsedShowId,

          tmdbId:
            details.id,

          seasonNumber:
            parsedSeasonNumber,

          name:
            normalizeString(
              details.name
            ),

          nameAr:
            arabic.name,

          overview:
            normalizeString(
              details.overview
            ),

          overviewAr:
            arabic.overview,

          posterPath:
            normalizeString(
              details.poster_path
            ),

          airDate:
            normalizeDate(
              details.air_date
            ),

          episodeCount:
            episodes.length,

          airedEpisodeCount:
            airedEpisodes.length,

          airedRuntimeMinutes,

          voteAverage:
            Math.min(
              10,
              normalizeNonNegativeNumber(
                details.vote_average
              )
            ),

          lastSyncedAt:
            new Date(),

          progressMetadataSyncedAt:
            new Date(),
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      }
    );

  if (syncEpisodes) {
    await syncEpisodesFromSeasonPayload({
      show,
      season,
      seasonDetails: details,
    });

    await recalculateShowAiredMetadata(
      parsedShowId
    );
  }

  return season;
}

// ======================================================
// Episode synchronization from season data
// ======================================================

async function syncEpisodesFromSeasonPayload({
  show,
  season,
  seasonDetails,
}) {
  const episodes = Array.isArray(
    seasonDetails?.episodes
  )
    ? seasonDetails.episodes
    : [];

  if (episodes.length === 0) {
    return [];
  }

  const operations = episodes
    .filter(
      (episode) =>
        episode?.id &&
        Number.isInteger(
          Number(
            episode.episode_number
          )
        ) &&
        Number(
          episode.episode_number
        ) >= 1
    )
    .map((episode) => ({
      updateOne: {
        filter: {
          showTmdbId:
            show.tmdbId,

          seasonNumber:
            season.seasonNumber,

          episodeNumber:
            Number(
              episode.episode_number
            ),
        },

        update: {
          $set: {
            show:
              show._id,

            season:
              season._id,

            showTmdbId:
              show.tmdbId,

            seasonTmdbId:
              season.tmdbId,

            tmdbId:
              episode.id,

            seasonNumber:
              season.seasonNumber,

            episodeNumber:
              Number(
                episode.episode_number
              ),

            name:
              normalizeString(
                episode.name
              ),

            overview:
              normalizeString(
                episode.overview
              ),

            airDate:
              normalizeDate(
                episode.air_date
              ),

            runtime:
              normalizeNullableNumber(
                episode.runtime
              ),

            stillPath:
              normalizeString(
                episode.still_path
              ),

            productionCode:
              normalizeString(
                episode.production_code
              ),

            voteAverage:
              Math.min(
                10,
                normalizeNonNegativeNumber(
                  episode.vote_average
                )
              ),

            voteCount:
              normalizeNonNegativeNumber(
                episode.vote_count
              ),

            crew:
              Array.isArray(
                episode.crew
              )
                ? episode.crew.map(
                    formatCrewMember
                  )
                : [],

            guestStars:
              Array.isArray(
                episode.guest_stars
              )
                ? episode.guest_stars.map(
                    formatGuestStar
                  )
                : [],

            lastSyncedAt:
              new Date(),
          },
        },

        upsert: true,
      },
    }));

  if (operations.length === 0) {
    return [];
  }

  await Episode.bulkWrite(
    operations,
    {
      ordered: false,
    }
  );

  return Episode.find({
    showTmdbId:
      show.tmdbId,

    seasonNumber:
      season.seasonNumber,
  }).sort({
    episodeNumber: 1,
  });
}

// ======================================================
// Sync every season in a show
// ======================================================

async function syncAllShowSeasons(
  showTmdbId,
  {
    force = false,
    includeSpecials = true,
  } = {}
) {
  const parsedShowId =
    parsePositiveInteger(showTmdbId);

  if (!parsedShowId) {
    throw new Error("Invalid TMDB show ID");
  }

  const details =
    await getTVShowDetails(
      parsedShowId,
      "en-US"
    );

  if (!details) {
    return null;
  }

  await syncShowFromTMDB(
    parsedShowId,
    {
      force,
    }
  );

  const seasons = Array.isArray(
    details.seasons
  )
    ? details.seasons
    : [];

  const seasonNumbers = seasons
    .map((season) =>
      Number(season?.season_number)
    )
    .filter(
      (seasonNumber) =>
        Number.isInteger(seasonNumber) &&
        seasonNumber >= 0 &&
        (
          includeSpecials ||
          seasonNumber > 0
        )
    )
    .sort((a, b) => a - b);

  const syncedSeasons = [];

  // Sequential requests avoid hammering TMDB and make errors easier
  // to isolate. We can add controlled concurrency later.
  for (const seasonNumber of seasonNumbers) {
    try {
      const season =
        await syncSeasonFromTMDB(
          parsedShowId,
          seasonNumber,
          {
            force,
            syncEpisodes: true,
          }
        );

      if (season) {
        syncedSeasons.push(season);
      }
    } catch (error) {
      console.error(
        `❌ Failed to sync show ${parsedShowId}, season ${seasonNumber}:`,
        error.message
      );
    }
  }

  await recalculateShowAiredMetadata(
    parsedShowId
  );

  return syncedSeasons;
}

// ======================================================
// Raw TMDB episode data
// ======================================================

async function getTVEpisodeDetails(
  showTmdbId,
  seasonNumber,
  episodeNumber,
  language = "en-US"
) {
  const parsedShowId =
    parsePositiveInteger(showTmdbId);

  const parsedSeasonNumber =
    parseSeasonNumber(seasonNumber);

  const parsedEpisodeNumber =
    parseEpisodeNumber(episodeNumber);

  if (
    !parsedShowId ||
    parsedSeasonNumber === null ||
    !parsedEpisodeNumber
  ) {
    return null;
  }

  const data = await tmdbGet(
    `/tv/${parsedShowId}/season/${parsedSeasonNumber}/episode/${parsedEpisodeNumber}`,
    {
      language,

      params: {
        append_to_response:
          EPISODE_APPEND_TO_RESPONSE,

        include_image_language:
          "en,ar,null",
      },
    }
  );

  if (!data?.id) {
    return null;
  }

  return data;
}

// ======================================================
// Detailed episode synchronization
// ======================================================

async function syncEpisodeFromTMDB(
  showTmdbId,
  seasonNumber,
  episodeNumber,
  {
    force = false,
    maxAgeMinutes = 360,
  } = {}
) {
  const parsedShowId =
    parsePositiveInteger(showTmdbId);

  const parsedSeasonNumber =
    parseSeasonNumber(seasonNumber);

  const parsedEpisodeNumber =
    parseEpisodeNumber(episodeNumber);

  if (
    !parsedShowId ||
    parsedSeasonNumber === null ||
    !parsedEpisodeNumber
  ) {
    throw new Error(
      "Invalid show, season, or episode number"
    );
  }

  const existingEpisode =
    await Episode.findOne({
      showTmdbId:
        parsedShowId,

      seasonNumber:
        parsedSeasonNumber,

      episodeNumber:
        parsedEpisodeNumber,
    });

  if (
    existingEpisode &&
    !force &&
    existingEpisode.lastSyncedAt
  ) {
    const ageMs =
      Date.now() -
      new Date(
        existingEpisode.lastSyncedAt
      ).getTime();

    const maxAgeMs =
      Math.max(1, maxAgeMinutes) *
      60 *
      1000;

    if (ageMs < maxAgeMs) {
      return existingEpisode;
    }
  }

  const [show, season, details] =
    await Promise.all([
      syncShowFromTMDB(
        parsedShowId,
        {
          force: false,
          maxAgeMinutes,
        }
      ),

      syncSeasonFromTMDB(
        parsedShowId,
        parsedSeasonNumber,
        {
          force: false,
          maxAgeMinutes,
          syncEpisodes: false,
        }
      ),

      getTVEpisodeDetails(
        parsedShowId,
        parsedSeasonNumber,
        parsedEpisodeNumber,
        "en-US"
      ),
    ]);

  if (!show || !season || !details) {
    return null;
  }

  const arabic =
    getArabicEpisodeTranslation(details);

  const episode =
    await Episode.findOneAndUpdate(
      {
        showTmdbId:
          parsedShowId,

        seasonNumber:
          parsedSeasonNumber,

        episodeNumber:
          parsedEpisodeNumber,
      },
      {
        $set: {
          show:
            show._id,

          season:
            season._id,

          showTmdbId:
            parsedShowId,

          seasonTmdbId:
            season.tmdbId,

          tmdbId:
            details.id,

          seasonNumber:
            parsedSeasonNumber,

          episodeNumber:
            parsedEpisodeNumber,

          name:
            normalizeString(
              details.name
            ),

          nameAr:
            arabic.name,

          overview:
            normalizeString(
              details.overview
            ),

          overviewAr:
            arabic.overview,

          airDate:
            normalizeDate(
              details.air_date
            ),

          runtime:
            normalizeNullableNumber(
              details.runtime
            ),

          stillPath:
            normalizeString(
              details.still_path
            ),

          productionCode:
            normalizeString(
              details.production_code
            ),

          voteAverage:
            Math.min(
              10,
              normalizeNonNegativeNumber(
                details.vote_average
              )
            ),

          voteCount:
            normalizeNonNegativeNumber(
              details.vote_count
            ),

          crew:
            Array.isArray(
              details.crew ||
              details.credits?.crew
            )
              ? (
                  details.crew ||
                  details.credits?.crew
                ).map(formatCrewMember)
              : [],

          guestStars:
            Array.isArray(
              details.guest_stars ||
              details.credits?.guest_stars
            )
              ? (
                  details.guest_stars ||
                  details.credits?.guest_stars
                ).map(formatGuestStar)
              : [],

          lastSyncedAt:
            new Date(),
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      }
    );

  await recalculateSeasonAiredMetadata(
    parsedShowId,
    parsedSeasonNumber
  );

  await recalculateShowAiredMetadata(
    parsedShowId
  );

  return episode;
}

// ======================================================
// Aired metadata recalculation
// ======================================================

async function recalculateSeasonAiredMetadata(
  showTmdbId,
  seasonNumber
) {
  const parsedShowId =
    parsePositiveInteger(showTmdbId);

  const parsedSeasonNumber =
    parseSeasonNumber(seasonNumber);

  if (
    !parsedShowId ||
    parsedSeasonNumber === null
  ) {
    return null;
  }

  const now = new Date();

  const episodes =
    await Episode.find({
      showTmdbId:
        parsedShowId,

      seasonNumber:
        parsedSeasonNumber,
    })
      .select(
        "airDate runtime"
      )
      .lean();

  const airedEpisodes =
    episodes.filter((episode) => {
      if (!episode.airDate) {
        return false;
      }

      return (
        new Date(
          episode.airDate
        ).getTime() <= now.getTime()
      );
    });

  const airedRuntimeMinutes =
    airedEpisodes.reduce(
      (total, episode) => {
        const runtime = Number(
          episode.runtime
        );

        return (
          total +
          (
            Number.isFinite(runtime) &&
            runtime > 0
              ? runtime
              : 0
          )
        );
      },
      0
    );

  return Season.findOneAndUpdate(
    {
      showTmdbId:
        parsedShowId,

      seasonNumber:
        parsedSeasonNumber,
    },
    {
      $set: {
        episodeCount:
          episodes.length,

        airedEpisodeCount:
          airedEpisodes.length,

        airedRuntimeMinutes,

        progressMetadataSyncedAt:
          new Date(),
      },
    },
    {
      new: true,
      runValidators: true,
    }
  );
}

async function recalculateShowAiredMetadata(
  showTmdbId
) {
  const parsedShowId =
    parsePositiveInteger(showTmdbId);

  if (!parsedShowId) {
    return null;
  }

  const now = new Date();

  const normalEpisodes =
    await Episode.find({
      showTmdbId:
        parsedShowId,

      seasonNumber: {
        $gt: 0,
      },

      airDate: {
        $ne: null,
        $lte: now,
      },
    })
      .select(
        "seasonNumber"
      )
      .lean();

  const airedSeasonNumbers =
    new Set(
      normalEpisodes.map(
        (episode) =>
          episode.seasonNumber
      )
    );

  return Show.findOneAndUpdate(
    {
      tmdbId:
        parsedShowId,
    },
    {
      $set: {
        airedEpisodeCount:
          normalEpisodes.length,

        airedSeasonCount:
          airedSeasonNumbers.size,

        progressMetadataSyncedAt:
          new Date(),
      },
    },
    {
      new: true,
      runValidators: true,
    }
  );
}

// ======================================================
// Cached retrieval helpers
// ======================================================

async function getCachedShow(
  showTmdbId,
  {
    syncIfMissing = true,
  } = {}
) {
  const parsedShowId =
    parsePositiveInteger(showTmdbId);

  if (!parsedShowId) {
    return null;
  }

  let show = await Show.findOne({
    tmdbId: parsedShowId,
  });

  if (!show && syncIfMissing) {
    show = await syncShowFromTMDB(
      parsedShowId
    );
  }

  return show;
}

async function getCachedSeason(
  showTmdbId,
  seasonNumber,
  {
    syncIfMissing = true,
  } = {}
) {
  const parsedShowId =
    parsePositiveInteger(showTmdbId);

  const parsedSeasonNumber =
    parseSeasonNumber(seasonNumber);

  if (
    !parsedShowId ||
    parsedSeasonNumber === null
  ) {
    return null;
  }

  let season =
    await Season.findOne({
      showTmdbId:
        parsedShowId,

      seasonNumber:
        parsedSeasonNumber,
    });

  if (!season && syncIfMissing) {
    season =
      await syncSeasonFromTMDB(
        parsedShowId,
        parsedSeasonNumber
      );
  }

  return season;
}

async function getCachedEpisode(
  showTmdbId,
  seasonNumber,
  episodeNumber,
  {
    syncIfMissing = true,
  } = {}
) {
  const parsedShowId =
    parsePositiveInteger(showTmdbId);

  const parsedSeasonNumber =
    parseSeasonNumber(seasonNumber);

  const parsedEpisodeNumber =
    parseEpisodeNumber(episodeNumber);

  if (
    !parsedShowId ||
    parsedSeasonNumber === null ||
    !parsedEpisodeNumber
  ) {
    return null;
  }

  let episode =
    await Episode.findOne({
      showTmdbId:
        parsedShowId,

      seasonNumber:
        parsedSeasonNumber,

      episodeNumber:
        parsedEpisodeNumber,
    });

  if (!episode && syncIfMissing) {
    episode =
      await syncEpisodeFromTMDB(
        parsedShowId,
        parsedSeasonNumber,
        parsedEpisodeNumber
      );
  }

  return episode;
}

// ======================================================
// Formatting helpers for routes
// ======================================================

function formatShowSearchResult(show) {
  return {
    id:
      show?.id || null,

    name_en:
      normalizeString(show?.name),

    original_name:
      normalizeString(
        show?.original_name
      ),

    poster_path:
      normalizeString(
        show?.poster_path
      ) || null,

    backdrop_path:
      normalizeString(
        show?.backdrop_path
      ) || null,

    first_air_date:
      normalizeString(
        show?.first_air_date
      ),

    year:
      extractYear(
        show?.first_air_date
      ),

    original_language:
      normalizeString(
        show?.original_language
      ),

    origin_country:
      Array.isArray(
        show?.origin_country
      )
        ? show.origin_country
        : [],

    genre_ids:
      Array.isArray(show?.genre_ids)
        ? show.genre_ids
        : [],

    overview:
      normalizeString(
        show?.overview
      ),

    vote_average:
      normalizeNonNegativeNumber(
        show?.vote_average
      ),

    vote_count:
      normalizeNonNegativeNumber(
        show?.vote_count
      ),

    popularity:
      normalizeNonNegativeNumber(
        show?.popularity
      ),
  };
}

// ======================================================
// Exports
// ======================================================

module.exports = {
  TMDB_BASE_URL,

  parsePositiveInteger,
  parseSeasonNumber,
  parseEpisodeNumber,

  searchTVShows,
  getTrendingTVShows,

  getTVShowDetails,
  getTVSeasonDetails,
  getTVEpisodeDetails,

  syncShowFromTMDB,
  syncSeasonFromTMDB,
  syncEpisodeFromTMDB,
  syncAllShowSeasons,
  syncEpisodesFromSeasonPayload,

  recalculateSeasonAiredMetadata,
  recalculateShowAiredMetadata,

  getCachedShow,
  getCachedSeason,
  getCachedEpisode,

  formatShowSearchResult,

  tmdbGet,
};

