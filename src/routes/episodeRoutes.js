// src/routes/episodeRoutes.js

const express = require("express");

const router = express.Router();

const Episode = require("../models/episodeModel");
const Season = require("../models/seasonModel");
const Show = require("../models/showModel");

const {
  parsePositiveInteger,
  parseSeasonNumber,
  parseEpisodeNumber,
  getTVEpisodeDetails,
  syncEpisodeFromTMDB,
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

  const date = new Date(airDate);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return date.getTime() <= Date.now();
}

function selectTrailer(videos) {
  const results =
    normalizeArray(videos?.results);

  const youtubeVideos =
    results.filter(
      (video) =>
        video?.site === "YouTube" &&
        typeof video?.key === "string" &&
        video.key.trim()
    );

  const selected =
    youtubeVideos.find(
      (video) =>
        video.type === "Trailer" &&
        video.official === true
    ) ||
    youtubeVideos.find(
      (video) =>
        video.type === "Trailer"
    ) ||
    youtubeVideos.find(
      (video) =>
        video.type === "Teaser"
    ) ||
    youtubeVideos.find(
      (video) =>
        video.type === "Clip"
    ) ||
    youtubeVideos[0] ||
    null;

  if (!selected) {
    return null;
  }

  return {
    key:
      selected.key,

    name:
      normalizeString(
        selected.name
      ),

    type:
      normalizeString(
        selected.type
      ),

    official:
      selected.official === true,

    site:
      selected.site,

    url:
      `https://www.youtube.com/watch?v=${selected.key}`,
  };
}

function formatCastMember(person) {
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
      normalizeString(
        person?.character
      ),

    creditId:
      normalizeString(
        person?.credit_id
      ),

    order:
      Number(person?.order) || 0,

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

function formatStill(image) {
  return {
    filePath:
      image?.file_path || null,

    url:
      imageUrl(
        image?.file_path,
        "original"
      ),

    width:
      Number(image?.width) || null,

    height:
      Number(image?.height) || null,

    aspectRatio:
      Number(
        image?.aspect_ratio
      ) || null,

    voteAverage:
      Number(
        image?.vote_average
      ) || 0,

    voteCount:
      Number(
        image?.vote_count
      ) || 0,
  };
}

// ======================================================
// GET /api/episodes/:showTmdbId/:seasonNumber/:episodeNumber
//
// Core Episode page response.
// ======================================================

router.get(
  "/:showTmdbId/:seasonNumber/:episodeNumber",
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

      const episodeNumber =
        parseEpisodeNumber(
          req.params.episodeNumber
        );

      if (
        !showTmdbId ||
        seasonNumber === null ||
        !episodeNumber
      ) {
        return res.status(400).json({
          error:
            "Invalid show, season, or episode number",
        });
      }

      const [
        detailsEnResult,
        detailsArResult,
      ] = await Promise.allSettled([
        getTVEpisodeDetails(
          showTmdbId,
          seasonNumber,
          episodeNumber,
          "en-US"
        ),

        getTVEpisodeDetails(
          showTmdbId,
          seasonNumber,
          episodeNumber,
          "ar-SA"
        ),
      ]);

      if (
        detailsEnResult.status !==
          "fulfilled" ||
        !detailsEnResult.value
      ) {
        return res.status(404).json({
          error: "Episode not found",
        });
      }

      const detailsEn =
        detailsEnResult.value;

      const detailsAr =
        detailsArResult.status ===
        "fulfilled"
          ? detailsArResult.value
          : null;

      let localEpisode = null;

      try {
        localEpisode =
          await syncEpisodeFromTMDB(
            showTmdbId,
            seasonNumber,
            episodeNumber
          );
      } catch (syncError) {
        console.error(
          "⚠️ Episode cache sync failed:",
          syncError.message
        );
      }

      const [
        show,
        season,
      ] = await Promise.all([
        Show.findOne({
          tmdbId: showTmdbId,
        }).lean(),

        Season.findOne({
          showTmdbId,
          seasonNumber,
        }).lean(),
      ]);

      const credits =
        detailsEn.credits || {};

      const cast =
        normalizeArray(
          credits.cast
        )
          .map(formatCastMember)
          .sort(
            (a, b) =>
              a.order - b.order
          );

      const guestStars =
        normalizeArray(
          detailsEn.guest_stars
        )
          .map(formatCastMember)
          .sort(
            (a, b) =>
              a.order - b.order
          );

      const combinedCast = [];
      const seenCastCredits =
        new Set();

      for (
        const person of [
          ...guestStars,
          ...cast,
        ]
      ) {
        const identity =
          person.creditId ||
          `${person.id}:${person.character}`;

        if (
          !identity ||
          seenCastCredits.has(identity)
        ) {
          continue;
        }

        seenCastCredits.add(identity);
        combinedCast.push(person);
      }

      const crew =
        normalizeArray(
          detailsEn.crew ||
          credits.crew
        ).map(formatCrewMember);

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

      const stills =
        normalizeArray(
          detailsEn.images?.stills
        )
          .map(formatStill)
          .filter(
            (still) => still.url
          )
          .slice(0, 40);

      const trailer =
        selectTrailer(
          detailsEn.videos
        );

      const airDate =
        detailsEn.air_date || null;

      const stillPath =
        detailsEn.still_path ||
        localEpisode?.stillPath ||
        null;

      const response = {
        id:
          detailsEn.id,

        tmdbId:
          detailsEn.id,

        localId:
          localEpisode?._id ||
          null,

        show: {
          tmdbId:
            showTmdbId,

          localId:
            show?._id || null,

          nameEn:
            show?.name || "",

          nameAr:
            show?.nameAr ||
            show?.name ||
            "",

          posterPath:
            show?.posterPath ||
            null,

          poster:
            imageUrl(
              show?.posterPath,
              "w500"
            ),

          backdropPath:
            show?.backdropPath ||
            null,

          backdrop:
            imageUrl(
              show?.backdropPath,
              "original"
            ),

          firstAirDate:
            show?.firstAirDate ||
            null,
        },

        season: {
          tmdbId:
            season?.tmdbId ||
            null,

          localId:
            season?._id || null,

          seasonNumber,

          nameEn:
            season?.name ||
            `Season ${seasonNumber}`,

          nameAr:
            season?.nameAr || "",

          posterPath:
            season?.posterPath ||
            null,

          poster:
            imageUrl(
              season?.posterPath,
              "w500"
            ),
        },

        seasonNumber,
        episodeNumber,

        code:
          `S${String(
            seasonNumber
          ).padStart(2, "0")}E${String(
            episodeNumber
          ).padStart(2, "0")}`,

        nameEn:
          detailsEn.name || "",

        nameAr:
          detailsAr?.name ||
          localEpisode?.nameAr ||
          detailsEn.name ||
          "",

        overviewEn:
          detailsEn.overview || "",

        overviewAr:
          detailsAr?.overview ||
          localEpisode?.overviewAr ||
          "",

        airDate,

        aired:
          isAired(airDate),

        runtime:
          Number(
            detailsEn.runtime
          ) || null,

        productionCode:
          normalizeString(
            detailsEn.production_code
          ),

        stillPath,

        still:
          imageUrl(
            stillPath,
            "original"
          ),

        voteAverage:
          Number(
            detailsEn.vote_average
          ) || 0,

        voteCount:
          Number(
            detailsEn.vote_count
          ) || 0,

        episodeType:
          normalizeString(
            detailsEn.episode_type
          ),

        trailer,
        stills,

        cast:
          combinedCast,

        guestStars,
        crew,
        directors,
        writers,
        cinematographers,

        externalIds:
          detailsEn.external_ids ||
          {},

        navigation: {
          previousEpisode:
            episodeNumber > 1
              ? {
                  showTmdbId,
                  seasonNumber,
                  episodeNumber:
                    episodeNumber - 1,
                }
              : null,

          nextEpisode: {
            showTmdbId,
            seasonNumber,
            episodeNumber:
              episodeNumber + 1,
          },
        },

        viewer: {
          watched: false,
          watchCount: 0,
          latestLog: null,
          rating: null,
          review: null,
          favoriteCharacter: null,
          customBackdrop: null,
        },

        community: {
          averageRating: null,
          ratingCount: 0,
          favoriteCharacter: null,
          followingRatings: [],
          popularReviews: [],
        },
      };

      return res
        .status(200)
        .json(response);
    } catch (error) {
      console.error(
        "❌ Episode details failed:",
        error
      );

      return res.status(500).json({
        error:
          "Failed to fetch episode details",
      });
    }
  }
);

// ======================================================
// GET /api/episodes/:showTmdbId/:seasonNumber/:episodeNumber/history
//
// Temporary read endpoint.
// Real log history is connected during tvLogRoutes.
// ======================================================

router.get(
  "/:showTmdbId/:seasonNumber/:episodeNumber/history",
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

      const episodeNumber =
        parseEpisodeNumber(
          req.params.episodeNumber
        );

      if (
        !showTmdbId ||
        seasonNumber === null ||
        !episodeNumber
      ) {
        return res.status(400).json({
          error:
            "Invalid show, season, or episode number",
        });
      }

      const episode =
        await Episode.findOne({
          showTmdbId,
          seasonNumber,
          episodeNumber,
        }).lean();

      if (!episode) {
        return res.status(404).json({
          error:
            "Episode has not been cached yet",
        });
      }

      return res.status(200).json({
        episode: {
          localId:
            episode._id,

          tmdbId:
            episode.tmdbId,

          showTmdbId:
            episode.showTmdbId,

          seasonNumber:
            episode.seasonNumber,

          episodeNumber:
            episode.episodeNumber,

          name:
            episode.name,
        },

        logs: [],
        totalLogs: 0,
      });
    } catch (error) {
      console.error(
        "❌ Episode history failed:",
        error
      );

      return res.status(500).json({
        error:
          "Failed to fetch episode history",
      });
    }
  }
);




// ======================================================
// Export
// ======================================================

module.exports = router;