// src/routes/seasonRoutes.js

const express = require("express");

const router = express.Router();

const Season = require("../models/seasonModel");
const Episode = require("../models/episodeModel");

const {
  parsePositiveInteger,
  parseSeasonNumber,
  syncSeasonFromTMDB,
  getTVSeasonDetails,
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

function isAired(airDate) {
  if (!airDate) {
    return false;
  }

  const parsed = new Date(airDate);

  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return parsed.getTime() <= Date.now();
}

function formatCrewMember(person) {
  return {
    id: Number(person?.id) || null,

    name:
      normalizeString(person?.name),

    job:
      normalizeString(person?.job),

    department:
      normalizeString(
        person?.department
      ),

    creditId:
      normalizeString(
        person?.credit_id
      ),

    profilePath:
      person?.profile_path || null,

    profile:
      imageUrl(
        person?.profile_path,
        "w500"
      ),
  };
}

function formatCastMember(person) {
  return {
    id: Number(person?.id) || null,

    name:
      normalizeString(person?.name),

    character:
      normalizeString(
        person?.character
      ),

    creditId:
      normalizeString(
        person?.credit_id
      ),

    order:
      Number(person?.order) || 0,

    profilePath:
      person?.profile_path || null,

    profile:
      imageUrl(
        person?.profile_path,
        "w500"
      ),
  };
}

function formatEpisode(episode) {
  return {
    id:
      Number(episode?.tmdbId) ||
      Number(episode?.id) ||
      null,

    localId:
      episode?._id || null,

    seasonNumber:
      Number.isInteger(
        Number(
          episode?.seasonNumber ??
            episode?.season_number
        )
      )
        ? Number(
            episode?.seasonNumber ??
              episode?.season_number
          )
        : null,

    episodeNumber:
      Number.isInteger(
        Number(
          episode?.episodeNumber ??
            episode?.episode_number
        )
      )
        ? Number(
            episode?.episodeNumber ??
              episode?.episode_number
          )
        : null,

    nameEn:
      normalizeString(
        episode?.name
      ),

    nameAr:
      normalizeString(
        episode?.nameAr
      ),

    overviewEn:
      normalizeString(
        episode?.overview
      ),

    overviewAr:
      normalizeString(
        episode?.overviewAr
      ),

    airDate:
      episode?.airDate ||
      episode?.air_date ||
      null,

    runtime:
      Number(
        episode?.runtime
      ) || null,

    stillPath:
      episode?.stillPath ||
      episode?.still_path ||
      null,

    still:
      imageUrl(
        episode?.stillPath ||
          episode?.still_path,
        "w780"
      ),

    voteAverage:
      Number(
        episode?.voteAverage ??
          episode?.vote_average
      ) || 0,

    voteCount:
      Number(
        episode?.voteCount ??
          episode?.vote_count
      ) || 0,

    aired:
      isAired(
        episode?.airDate ||
          episode?.air_date
      ),

    viewer: {
      watched: false,
      watchCount: 0,
      latestLogId: null,
      rating: null,
      hasReview: false,
      favoriteCharacter: null,
    },
  };
}

// ======================================================
// GET /api/seasons/:showTmdbId
//
// Returns all season summaries for a show.
// Does not necessarily sync every episode.
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

      const includeSpecials =
        req.query.includeSpecials !==
        "false";

      const details =
        await getTVSeasonList(
          showTmdbId
        );

      if (!details) {
        return res.status(404).json({
          error: "Show not found",
        });
      }

      const localSeasons =
        await Season.find({
          showTmdbId,
        })
          .sort({
            seasonNumber: 1,
          })
          .lean();

      const localMap = new Map(
        localSeasons.map((season) => [
          Number(season.seasonNumber),
          season,
        ])
      );

      const seasons =
        normalizeArray(details.seasons)
          .filter((season) => {
            const seasonNumber =
              Number(
                season?.season_number
              );

            return (
              Number.isInteger(
                seasonNumber
              ) &&
              seasonNumber >= 0 &&
              (
                includeSpecials ||
                seasonNumber > 0
              )
            );
          })
          .map((season) => {
            const seasonNumber =
              Number(
                season.season_number
              );

            const local =
              localMap.get(
                seasonNumber
              );

            return {
              id:
                Number(season.id) ||
                null,

              localId:
                local?._id || null,

              seasonNumber,

              name:
                normalizeString(
                  season.name
                ),

              nameAr:
                normalizeString(
                  local?.nameAr
                ),

              overview:
                normalizeString(
                  season.overview
                ),

              overviewAr:
                normalizeString(
                  local?.overviewAr
                ),

              posterPath:
                season.poster_path ||
                null,

              poster:
                imageUrl(
                  season.poster_path,
                  "w500"
                ),

              airDate:
                season.air_date ||
                null,

              episodeCount:
                Number(
                  season.episode_count
                ) || 0,

              airedEpisodeCount:
                Number(
                  local?.airedEpisodeCount
                ) || 0,

              airedRuntimeMinutes:
                Number(
                  local?.airedRuntimeMinutes
                ) || 0,

              voteAverage:
                Number(
                  season.vote_average
                ) || 0,

              isSpecials:
                seasonNumber === 0,

              isSynced:
                Boolean(local),

              viewer: {
                watchedEpisodeCount: 0,
                progressPercentage: 0,
                completed: false,
              },
            };
          })
          .sort(
            (a, b) =>
              a.seasonNumber -
              b.seasonNumber
          );

      return res.status(200).json({
        show: {
          id:
            details.id,

          name:
            details.name || "",

          posterPath:
            details.poster_path ||
            null,

          backdropPath:
            details.backdrop_path ||
            null,
        },

        seasons,
      });
    } catch (error) {
      console.error(
        "❌ Season list failed:",
        error
      );

      return res.status(500).json({
        error:
          "Failed to fetch seasons",
      });
    }
  }
);

// ======================================================
// GET /api/seasons/:showTmdbId/:seasonNumber
//
// Expands one season and synchronizes its episodes.
// ======================================================

router.get(
  "/:showTmdbId/:seasonNumber",
  async (req, res) => {
    try {
      const showTmdbId =
        parsePositiveInteger(
          req.params.showTmdbId
        );

      const seasonNumber =
        parseSeasonNumber(
          req.params.seasonNumber
        );

      if (
        !showTmdbId ||
        seasonNumber === null
      ) {
        return res.status(400).json({
          error:
            "Invalid show or season number",
        });
      }

      /*
       * Cache-first season response.
       *
       * Opening the picker should not require three TMDB requests every
       * single time. If this season and its episodes already exist locally,
       * return them immediately. Use ?refresh=true only when an explicit
       * metadata refresh is required.
       */
      const forceRefresh =
        req.query.refresh === "true";

      if (!forceRefresh) {
        const [
          cachedSeason,
          cachedEpisodes,
        ] = await Promise.all([
          Season.findOne({
            showTmdbId,
            seasonNumber,
          }).lean(),

          Episode.find({
            showTmdbId,
            seasonNumber,
          })
            .sort({
              episodeNumber: 1,
            })
            .lean(),
        ]);

        if (
          cachedSeason &&
          cachedEpisodes.length > 0
        ) {
          return res.status(200).json({
            showTmdbId,

            season: {
              id:
                cachedSeason.tmdbId,

              localId:
                cachedSeason._id,

              seasonNumber:
                cachedSeason.seasonNumber,

              nameEn:
                cachedSeason.name || "",

              nameAr:
                cachedSeason.nameAr || "",

              overviewEn:
                cachedSeason.overview || "",

              overviewAr:
                cachedSeason.overviewAr || "",

              posterPath:
                cachedSeason.posterPath ||
                null,

              poster:
                imageUrl(
                  cachedSeason.posterPath,
                  "w500"
                ),

              airDate:
                cachedSeason.airDate,

              episodeCount:
                cachedSeason.episodeCount,

              airedEpisodeCount:
                cachedSeason
                  .airedEpisodeCount,

              airedRuntimeMinutes:
                cachedSeason
                  .airedRuntimeMinutes,

              voteAverage:
                cachedSeason.voteAverage,

              isSpecials:
                cachedSeason.seasonNumber ===
                0,

              viewer: {
                watchedEpisodeCount: 0,
                progressPercentage: 0,
                completed: false,
              },
            },

            episodes:
              cachedEpisodes.map(
                formatEpisode
              ),

            source:
              "cache",
          });
        }
      }

      const [
        season,
        detailsEnResult,
        detailsArResult,
      ] = await Promise.all([
        syncSeasonFromTMDB(
          showTmdbId,
          seasonNumber,
          {
            syncEpisodes: true,
          }
        ),

        getTVSeasonDetails(
          showTmdbId,
          seasonNumber,
          "en-US"
        ),

        getTVSeasonDetails(
          showTmdbId,
          seasonNumber,
          "ar-SA"
        ),
      ]);

      if (
        !season ||
        !detailsEnResult
      ) {
        return res.status(404).json({
          error: "Season not found",
        });
      }

      const episodes =
        await Episode.find({
          showTmdbId,
          seasonNumber,
        })
          .sort({
            episodeNumber: 1,
          })
          .lean();

      const detailsAr =
        detailsArResult || null;

      const arabicEpisodeMap =
        new Map(
          normalizeArray(
            detailsAr?.episodes
          ).map((episode) => [
            Number(
              episode.episode_number
            ),
            episode,
          ])
        );

      const formattedEpisodes =
        episodes.map((episode) => {
          const ArabicEpisode =
            arabicEpisodeMap.get(
              Number(
                episode.episodeNumber
              )
            );

          return {
            ...formatEpisode(episode),

            nameAr:
              normalizeString(
                ArabicEpisode?.name
              ) ||
              normalizeString(
                episode.nameAr
              ),

            overviewAr:
              normalizeString(
                ArabicEpisode?.overview
              ) ||
              normalizeString(
                episode.overviewAr
              ),
          };
        });

      return res.status(200).json({
        showTmdbId,

        season: {
          id:
            season.tmdbId,

          localId:
            season._id,

          seasonNumber:
            season.seasonNumber,

          nameEn:
            season.name || "",

          nameAr:
            detailsAr?.name ||
            season.nameAr ||
            "",

          overviewEn:
            season.overview || "",

          overviewAr:
            detailsAr?.overview ||
            season.overviewAr ||
            "",

          posterPath:
            season.posterPath ||
            null,

          poster:
            imageUrl(
              season.posterPath,
              "w500"
            ),

          airDate:
            season.airDate,

          episodeCount:
            season.episodeCount,

          airedEpisodeCount:
            season.airedEpisodeCount,

          airedRuntimeMinutes:
            season.airedRuntimeMinutes,

          voteAverage:
            season.voteAverage,

          isSpecials:
            season.seasonNumber ===
            0,

          viewer: {
            watchedEpisodeCount: 0,
            progressPercentage: 0,
            completed: false,
          },
        },

        episodes:
          formattedEpisodes,
      });
    } catch (error) {
      console.error(
        "❌ Season details failed:",
        error
      );

      return res.status(500).json({
        error:
          "Failed to fetch season details",
      });
    }
  }
);

// ======================================================
// Small helper: fetch show details only for season list.
// ======================================================

async function getTVSeasonList(
  showTmdbId
) {
  const {
    getTVShowDetails,
  } = require("../services/tvMetadataService");

  return getTVShowDetails(
    showTmdbId,
    "en-US"
  );
}

// ======================================================
// Export
// ======================================================

module.exports = router;