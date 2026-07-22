// src/routes/showRoutes.js

const express = require("express");

const router = express.Router();

const Show = require("../models/showModel");
const Season = require("../models/seasonModel");

const {
  parsePositiveInteger,
  getTrendingTVShows,
  getTVShowDetails,
  syncShowFromTMDB,
  formatShowSearchResult,
} = require("../services/tvMetadataService");

const TMDB_IMAGE_BASE =
  "https://image.tmdb.org/t/p";

// ======================================================
// Helpers
// ======================================================

function imageUrl(path, size = "original") {
  if (
    typeof path !== "string" ||
    !path.trim()
  ) {
    return null;
  }

  const cleanPath = path.trim();

  if (
    cleanPath.startsWith("http://") ||
    cleanPath.startsWith("https://")
  ) {
    return cleanPath;
  }

  return `${TMDB_IMAGE_BASE}/${size}${cleanPath}`;
}

function normalizeString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function normalizeArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}

function getYear(dateValue) {
  if (!dateValue) {
    return null;
  }

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.getUTCFullYear();
}

function selectTrailer(videos) {
  const results = normalizeArray(
    videos?.results
  );

  const youtubeVideos = results.filter(
    (video) =>
      video?.site === "YouTube" &&
      video?.key
  );

  const officialTrailer =
    youtubeVideos.find(
      (video) =>
        video.type === "Trailer" &&
        video.official === true
    );

  const anyTrailer =
    youtubeVideos.find(
      (video) =>
        video.type === "Trailer"
    );

  const teaser =
    youtubeVideos.find(
      (video) =>
        video.type === "Teaser"
    );

  const selected =
    officialTrailer ||
    anyTrailer ||
    teaser ||
    youtubeVideos[0] ||
    null;

  if (!selected) {
    return null;
  }

  return {
    key: selected.key,
    name:
      normalizeString(selected.name),
    type:
      normalizeString(selected.type),
    official:
      selected.official === true,
    site:
      selected.site,
    url:
      `https://www.youtube.com/watch?v=${selected.key}`,
  };
}

function formatPerson(person) {
  const roles =
    normalizeArray(person?.roles);

  const characterNames = [
    ...new Set(
      roles
        .map((role) =>
          normalizeString(
            role?.character
          )
        )
        .filter(Boolean)
    ),
  ];

  return {
    id:
      Number(person?.id) || null,

    name:
      normalizeString(person?.name),

    originalName:
      normalizeString(
        person?.original_name
      ),

    character:
      characterNames.length > 0
        ? characterNames.join(" / ")
        : normalizeString(
            person?.character
          ),

    knownForDepartment:
      normalizeString(
        person?.known_for_department
      ),

    profilePath:
      person?.profile_path || null,

    profile:
      imageUrl(
        person?.profile_path,
        "w500"
      ),

    order:
      Number(
        person?.order ??
        roles?.[0]?.order
      ) || 0,

    episodeCount:
      Number(
        person?.total_episode_count
      ) || 0,

    creditId:
      normalizeString(
        person?.credit_id ??
        roles?.[0]?.credit_id
      ),
  };
}

function formatCrewMember(person) {
  return {
    id:
      Number(person?.id) || null,

    name:
      normalizeString(person?.name),

    job:
      normalizeString(person?.job),

    department:
      normalizeString(
        person?.department
      ),

    profilePath:
      person?.profile_path || null,

    profile:
      imageUrl(
        person?.profile_path,
        "w500"
      ),

    creditId:
      normalizeString(
        person?.credit_id
      ),
  };
}

function formatSeasonSummary(season) {
  return {
    id:
      Number(season?.id) || null,

    seasonNumber:
      Number.isInteger(
        Number(season?.season_number)
      )
        ? Number(season.season_number)
        : null,

    name:
      normalizeString(season?.name),

    overview:
      normalizeString(
        season?.overview
      ),

    posterPath:
      season?.poster_path || null,

    poster:
      imageUrl(
        season?.poster_path,
        "w500"
      ),

    airDate:
      season?.air_date || null,

    episodeCount:
      Number(
        season?.episode_count
      ) || 0,

    voteAverage:
      Number(
        season?.vote_average
      ) || 0,

    isSpecials:
      Number(
        season?.season_number
      ) === 0,
  };
}

function formatSimilarShow(show) {
  return {
    ...formatShowSearchResult(show),

    poster:
      imageUrl(
        show?.poster_path,
        "w500"
      ),

    backdrop:
      imageUrl(
        show?.backdrop_path,
        "w780"
      ),
  };
}

function formatWatchProviders(providerData) {
  const regions =
    providerData?.results &&
    typeof providerData.results === "object"
      ? providerData.results
      : {};

  const formatProvider = (provider) => ({
    id:
      Number(provider?.provider_id) ||
      null,

    name:
      normalizeString(
        provider?.provider_name
      ),

    logoPath:
      provider?.logo_path || null,

    logo:
      imageUrl(
        provider?.logo_path,
        "w300"
      ),

    displayPriority:
      Number(
        provider?.display_priority
      ) || 0,
  });

  const formatRegion = (region) => ({
    link:
      normalizeString(region?.link),

    streaming:
      normalizeArray(region?.flatrate)
        .map(formatProvider),

    rent:
      normalizeArray(region?.rent)
        .map(formatProvider),

    buy:
      normalizeArray(region?.buy)
        .map(formatProvider),

    free:
      normalizeArray(region?.free)
        .map(formatProvider),

    ads:
      normalizeArray(region?.ads)
        .map(formatProvider),
  });

  return {
    SA:
      regions.SA
        ? formatRegion(regions.SA)
        : null,

    US:
      regions.US
        ? formatRegion(regions.US)
        : null,

    regions,
  };
}

// ======================================================
// GET /api/shows/trending
// ======================================================

router.get(
  "/trending",
  async (req, res) => {
    try {
      const language =
        req.query.language === "ar-SA"
          ? "ar-SA"
          : "en-US";

      const timeWindow =
        req.query.window === "day"
          ? "day"
          : "week";

      const limitValue =
        Number(req.query.limit);

      const limit =
        Number.isInteger(limitValue) &&
        limitValue > 0
          ? Math.min(limitValue, 40)
          : 20;

      const shows =
        await getTrendingTVShows(
          language,
          timeWindow
        );

      const results =
        normalizeArray(shows)
          .slice(0, limit)
          .map(formatSimilarShow);

      return res.status(200).json({
        results,
        timeWindow,
        language,
      });
    } catch (error) {
      console.error(
        "❌ Trending TV shows failed:",
        error
      );

      return res.status(500).json({
        error:
          "Failed to fetch trending shows",
      });
    }
  }
);

// ======================================================
// GET /api/shows/:showTmdbId
//
// Core Show page response.
// ======================================================

router.get(
  "/:showTmdbId",
  async (req, res) => {
    try {
      const showTmdbId =
        parsePositiveInteger(
          req.params.showTmdbId
        );

      if (!showTmdbId) {
        return res.status(400).json({
          error: "Invalid show ID",
        });
      }

      const [
        detailsEnResult,
        detailsArResult,
      ] = await Promise.allSettled([
        getTVShowDetails(
          showTmdbId,
          "en-US"
        ),

        getTVShowDetails(
          showTmdbId,
          "ar-SA"
        ),
      ]);

      if (
        detailsEnResult.status !==
          "fulfilled" ||
        !detailsEnResult.value
      ) {
        return res.status(404).json({
          error: "Show not found",
        });
      }

      const detailsEn =
        detailsEnResult.value;

      const detailsAr =
        detailsArResult.status ===
        "fulfilled"
          ? detailsArResult.value
          : null;

      /*
       * Save or refresh the local Show document.
       *
       * We intentionally do not block the entire response if
       * local caching fails after TMDB returned successfully.
       */
      let localShow = null;

      try {
        localShow =
          await syncShowFromTMDB(
            showTmdbId
          );
      } catch (syncError) {
        console.error(
          "⚠️ Show cache sync failed:",
          syncError.message
        );
      }

      const localSeasons =
        await Season.find({
          showTmdbId,
        })
          .sort({
            seasonNumber: 1,
          })
          .lean();

      const localSeasonMap = new Map(
        localSeasons.map((season) => [
          Number(season.seasonNumber),
          season,
        ])
      );

      const seasons =
        normalizeArray(
          detailsEn.seasons
        )
          .map((season) => {
            const formatted =
              formatSeasonSummary(
                season
              );

            const local =
              localSeasonMap.get(
                formatted.seasonNumber
              );

            return {
              ...formatted,

              airedEpisodeCount:
                Number(
                  local?.airedEpisodeCount
                ) || 0,

              airedRuntimeMinutes:
                Number(
                  local?.airedRuntimeMinutes
                ) || 0,

              isCached:
                Boolean(local),

              lastSyncedAt:
                local?.lastSyncedAt ||
                null,
            };
          })
          .sort(
            (a, b) =>
              (
                a.seasonNumber ?? 0
              ) -
              (
                b.seasonNumber ?? 0
              )
          );

      const aggregateCast =
        normalizeArray(
          detailsEn.aggregate_credits?.cast
        );

      const regularCast =
        normalizeArray(
          detailsEn.credits?.cast
        );

      const castSource =
        aggregateCast.length > 0
          ? aggregateCast
          : regularCast;

      const cast =
        castSource
          .map(formatPerson)
          .filter(
            (person) =>
              person.id &&
              person.name
          )
          .sort(
            (a, b) =>
              (
                b.episodeCount || 0
              ) -
                (
                  a.episodeCount || 0
                ) ||
              (
                a.order || 0
              ) -
                (
                  b.order || 0
                )
          );

      const crew =
        normalizeArray(
          detailsEn.credits?.crew
        ).map(formatCrewMember);

      const creators =
        normalizeArray(
          detailsEn.created_by
        ).map((creator) => ({
          id:
            Number(creator?.id) ||
            null,

          name:
            normalizeString(
              creator?.name
            ),

          profilePath:
            creator?.profile_path ||
            null,

          profile:
            imageUrl(
              creator?.profile_path,
              "w500"
            ),
        }));

      const directors =
        crew.filter(
          (person) =>
            person.job === "Director"
        );

      const writers =
        crew.filter(
          (person) =>
            person.department ===
              "Writing" ||
            [
              "Writer",
              "Screenplay",
              "Teleplay",
              "Story",
            ].includes(person.job)
        );

      const cinematographers =
        crew.filter(
          (person) =>
            [
              "Director of Photography",
              "Cinematography",
              "Cinematographer",
            ].includes(person.job)
        );

      const backdrops =
        normalizeArray(
          detailsEn.images?.backdrops
        )
          .map((backdrop) => ({
            filePath:
              backdrop?.file_path ||
              null,

            url:
              imageUrl(
                backdrop?.file_path,
                "original"
              ),

            width:
              Number(backdrop?.width) ||
              null,

            height:
              Number(
                backdrop?.height
              ) || null,

            voteAverage:
              Number(
                backdrop?.vote_average
              ) || 0,
          }))
          .filter(
            (backdrop) =>
              backdrop.url
          );

      const posters =
        normalizeArray(
          detailsEn.images?.posters
        )
          .map((poster) => ({
            filePath:
              poster?.file_path ||
              null,

            url:
              imageUrl(
                poster?.file_path,
                "w780"
              ),

            width:
              Number(poster?.width) ||
              null,

            height:
              Number(poster?.height) ||
              null,

            voteAverage:
              Number(
                poster?.vote_average
              ) || 0,
          }))
          .filter(
            (poster) => poster.url
          );

      const recommendations =
        normalizeArray(
          detailsEn.recommendations
            ?.results
        );

      const similarResults =
        normalizeArray(
          detailsEn.similar?.results
        );

      const combinedSimilar = [];
      const seenSimilarIds = new Set();

      for (
        const show of [
          ...recommendations,
          ...similarResults,
        ]
      ) {
        const id = Number(show?.id);

        if (
          !id ||
          id === showTmdbId ||
          seenSimilarIds.has(id)
        ) {
          continue;
        }

        seenSimilarIds.add(id);

        combinedSimilar.push(
          formatSimilarShow(show)
        );

        if (
          combinedSimilar.length >= 20
        ) {
          break;
        }
      }

      const trailer =
        selectTrailer(
          detailsEn.videos
        );

      const watchProviders =
        formatWatchProviders(
          detailsEn["watch/providers"]
        );

      const firstAirDate =
        detailsEn.first_air_date ||
        "";

      const response = {
        id:
          detailsEn.id,

        tmdbId:
          detailsEn.id,

        localId:
          localShow?._id || null,

        nameEn:
          detailsEn.name || "",

        nameAr:
          detailsAr?.name ||
          localShow?.nameAr ||
          detailsEn.name ||
          "",

        originalName:
          detailsEn.original_name ||
          "",

        year:
          getYear(firstAirDate),

        taglineEn:
          detailsEn.tagline || "",

        taglineAr:
          detailsAr?.tagline || "",

        overviewEn:
          detailsEn.overview || "",

        overviewAr:
          detailsAr?.overview || "",

        posterPath:
          detailsEn.poster_path ||
          null,

        poster:
          imageUrl(
            detailsEn.poster_path,
            "w780"
          ),

        backdropPath:
          detailsEn.backdrop_path ||
          null,

        backdrop:
          imageUrl(
            detailsEn.backdrop_path,
            "original"
          ),

        firstAirDate,

        lastAirDate:
          detailsEn.last_air_date ||
          "",

        status:
          detailsEn.status || "",

        type:
          detailsEn.type || "",

        inProduction:
          detailsEn.in_production ===
          true,

        adult:
          detailsEn.adult === true,

        originalLanguage:
          detailsEn.original_language ||
          "",

        originCountry:
          normalizeArray(
            detailsEn.origin_country
          ),

        genres:
          normalizeArray(
            detailsEn.genres
          ),

        networks:
          normalizeArray(
            detailsEn.networks
          ).map((network) => ({
            id:
              Number(network?.id) ||
              null,

            name:
              normalizeString(
                network?.name
              ),

            logoPath:
              network?.logo_path ||
              null,

            logo:
              imageUrl(
                network?.logo_path,
                "w300"
              ),

            originCountry:
              normalizeString(
                network?.origin_country
              ),
          })),

        creators,

        numberOfSeasons:
          Number(
            detailsEn.number_of_seasons
          ) || 0,

        numberOfEpisodes:
          Number(
            detailsEn.number_of_episodes
          ) || 0,

        airedEpisodeCount:
          Number(
            localShow
              ?.airedEpisodeCount
          ) || 0,

        airedSeasonCount:
          Number(
            localShow
              ?.airedSeasonCount
          ) || 0,

        episodeRunTime:
          normalizeArray(
            detailsEn.episode_run_time
          ),

        averageRuntime:
          localShow?.averageRuntime ||
          null,

        popularity:
          Number(
            detailsEn.popularity
          ) || 0,

        voteAverage:
          Number(
            detailsEn.vote_average
          ) || 0,

        voteCount:
          Number(
            detailsEn.vote_count
          ) || 0,

        homepage:
          detailsEn.homepage || "",

        trailer,

        posters,
        backdrops,
        seasons,

        cast,
        crew,
        directors,
        writers,
        cinematographers,

        similarShows:
          combinedSimilar,

        watchProviders,

        lastEpisodeToAir:
          detailsEn.last_episode_to_air ||
          null,

        nextEpisodeToAir:
          detailsEn.next_episode_to_air ||
          null,

        externalIds:
          detailsEn.external_ids || {},

        /*
         * These social/user-specific values will be added after
         * tvProgressService and the character/review routes exist.
         */
        viewer: {
          progress: null,
          favoriteCharacter: null,
          customPoster: null,
          isInWatchlist: false,
        },

        community: {
          averageFollowingProgress:
            null,

          followingProgress: [],

          favoriteCharacter: null,

          reviews: [],
        },
      };

      return res
        .status(200)
        .json(response);
    } catch (error) {
      console.error(
        "❌ Show details failed:",
        error
      );

      return res.status(500).json({
        error:
          "Failed to fetch show details",
      });
    }
  }
);

// ======================================================
// Export
// ======================================================

module.exports = router;

