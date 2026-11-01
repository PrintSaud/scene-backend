const express = require("express");
const axios = require("axios");

const User = require("../models/user");
const List = require("../models/list");
const MediaSearchOverride = require("../models/mediaSearchOverride");

const {
  filterMediaSearchResults,
  containsBannedWord,
} = require(
  "../utils/mediaSearchFilter"
);

const router = express.Router();

const TMDB_API_KEY =
  process.env.TMDB_API_KEY;

const TMDB_BASE =
  "https://api.themoviedb.org/3";

const normalizeSearchText = (value) =>
  String(value || "")
    .toLowerCase()
    .trim();

const mediaMatchesQuery = (
  item,
  mediaType,
  query
) => {
  const q =
    normalizeSearchText(query);

  if (!q) {
    return false;
  }

  const values =
    mediaType === "tv"
      ? [
          item?.name,
          item?.original_name,
        ]
      : [
          item?.title,
          item?.original_title,
        ];

  return values.some(
    (value) =>
      normalizeSearchText(value)
        .includes(q)
  );
};

const loadForceAllowedMatches = async (
  mediaType,
  query
) => {
  const overrides =
    await MediaSearchOverride.find({
      mediaType,
      action: "allow",
    }).lean();

  if (!overrides.length) {
    return [];
  }

  const endpoint =
    mediaType === "tv"
      ? "tv"
      : "movie";

  const fetched = [];

  for (const override of overrides) {
    try {
      const response =
        await axios.get(
          `${TMDB_BASE}/${endpoint}/${override.tmdbId}`,
          {
            params: {
              api_key:
                TMDB_API_KEY,
            },
          }
        );

      const item =
        response.data;

      if (
        item &&
        mediaMatchesQuery(
          item,
          mediaType,
          query
        )
      ) {
        fetched.push(item);
      }
    } catch (error) {
      console.warn(
        "⚠️ Force-allow TMDB fetch failed:",
        {
          tmdbId:
            override.tmdbId,
          mediaType,
          message:
            error?.message,
        }
      );
    }
  }

  return fetched;
};

const uniqById = (items) => {
  const map = new Map();

  for (const item of items || []) {
    const id =
      Number(item?.id);

    if (
      Number.isInteger(id) &&
      id > 0 &&
      !map.has(id)
    ) {
      map.set(id, item);
    }
  }

  return [...map.values()];
};

const searchTmdbMedia =
  async (
    mediaType,
    query
  ) => {
    if (!TMDB_API_KEY) {
      throw new Error(
        "TMDB_API_KEY is not configured"
      );
    }

    const endpoint =
      mediaType === "tv"
        ? "tv"
        : "movie";

    const [page1, page2] =
      await Promise.all([
        axios.get(
          `${TMDB_BASE}/search/${endpoint}`,
          {
            params: {
              api_key:
                TMDB_API_KEY,
              query,
              page: 1,
              include_adult:
                false,
            },
          }
        ),

        axios.get(
          `${TMDB_BASE}/search/${endpoint}`,
          {
            params: {
              api_key:
                TMDB_API_KEY,
              query,
              page: 2,
              include_adult:
                false,
            },
          }
        ),
      ]);

    const forceAllowed =
      await loadForceAllowedMatches(
        mediaType,
        query
      );

    const combined =
      uniqById([
        ...forceAllowed,

        ...(
          page1.data?.results ||
          []
        ),

        ...(
          page2.data?.results ||
          []
        ),
      ]);

    return filterMediaSearchResults(
      combined,
      mediaType
    );
  };



const normalizeMovieFilters = (req) => {
  const genreRaw =
    String(req.query.genre || "").trim();

  const decadeRaw =
    String(req.query.decade || "").trim();

  const countryRaw =
    String(req.query.country || "")
      .trim()
      .toUpperCase();

  const sortRaw =
    String(req.query.sort || "relevance")
      .trim()
      .toLowerCase();

  const genre =
    /^\d+$/.test(genreRaw)
      ? Number(genreRaw)
      : null;

  const decade =
    /^\d{4}$/.test(decadeRaw)
      ? Number(decadeRaw)
      : null;

  const country =
    /^[A-Z]{2}$/.test(countryRaw)
      ? countryRaw
      : null;

  const allowedSorts =
    new Set([
      "relevance",
      "rating",
      "newest",
      "oldest",
    ]);

  const sort =
    allowedSorts.has(sortRaw)
      ? sortRaw
      : "relevance";

  return {
    genre,
    decade,
    country,
    sort,
  };
};

const movieMatchesBasicFilters = (
  movie,
  filters
) => {
  if (filters.genre) {
    const genreIds =
      Array.isArray(movie?.genre_ids)
        ? movie.genre_ids
        : Array.isArray(movie?.genres)
        ? movie.genres
            .map((genre) =>
              Number(genre?.id)
            )
            .filter(Number.isFinite)
        : [];

    if (
      !genreIds.includes(
        filters.genre
      )
    ) {
      return false;
    }
  }

  if (filters.decade) {
    const year =
      Number(
        String(
          movie?.release_date || ""
        ).slice(0, 4)
      );

    if (
      !Number.isInteger(year) ||
      year < filters.decade ||
      year > filters.decade + 9
    ) {
      return false;
    }
  }

  return true;
};

const applyMovieSort = (
  movies,
  sort
) => {
  const result = [
    ...(movies || []),
  ];

  if (sort === "relevance") {
    const normalizedQuery =
      normalizeSearchText(query);

    return output.sort((a, b) => {
      const scoreMovie = (movie) => {
        const title =
          normalizeSearchText(
            movie?.title ||
            movie?.original_title ||
            ""
          );

        const originalTitle =
          normalizeSearchText(
            movie?.original_title ||
            ""
          );

        const votes =
          Math.max(
            0,
            Number(movie?.vote_count || 0)
          );

        const rating =
          Math.max(
            0,
            Number(movie?.vote_average || 0)
          );

        let titleScore = 0;

        if (normalizedQuery) {
          // Exact title should dominate everything.
          if (
            title === normalizedQuery ||
            originalTitle === normalizedQuery
          ) {
            titleScore = 1000;
          }

          // "Batman Begins" for "batman"
          else if (
            title.startsWith(normalizedQuery) ||
            originalTitle.startsWith(normalizedQuery)
          ) {
            titleScore = 700;
          }

          // General title containment.
          else if (
            title.includes(normalizedQuery) ||
            originalTitle.includes(normalizedQuery)
          ) {
            titleScore = 500;
          }
        }

        /*
         * Vote confidence is logarithmic.
         *
         * This gives established movies a strong
         * advantage without letting gigantic movies
         * completely destroy title relevance.
         *
         * 1 vote       ≈ 0.3
         * 100 votes    ≈ 2
         * 10,000 votes ≈ 4
         */
        const voteScore =
          Math.log10(votes + 1) * 60;

        /*
         * Rating matters, but much less than
         * title relevance + audience confidence.
         */
        const ratingScore =
          rating * 2;

        return (
          titleScore +
          voteScore +
          ratingScore
        );
      };

      const aScore =
        scoreMovie(a);

      const bScore =
        scoreMovie(b);

      if (bScore !== aScore) {
        return bScore - aScore;
      }

      // Final tie-breaker:
      // more votes wins.
      return (
        Number(b?.vote_count || 0) -
        Number(a?.vote_count || 0)
      );
    });
  }

  if (sort === "rating") {
    return result.sort((a, b) => {
      const aVotes =
        Number(a?.vote_count || 0);

      const bVotes =
        Number(b?.vote_count || 0);

      const aRating =
        Number(a?.vote_average || 0);

      const bRating =
        Number(b?.vote_average || 0);

      /*
       * Confidence-weighted rating.
       *
       * Prevents a random 10/10 with
       * 1 or 2 votes from beating
       * genuinely well-rated movies.
       */
      const aConfidence =
        Math.min(
          1,
          Math.log10(aVotes + 1) / 3
        );

      const bConfidence =
        Math.min(
          1,
          Math.log10(bVotes + 1) / 3
        );

      const aScore =
        aRating * aConfidence;

      const bScore =
        bRating * bConfidence;

      if (bScore !== aScore) {
        return bScore - aScore;
      }

      return bVotes - aVotes;
    });
  }

  if (sort === "newest") {
    return result.sort(
      (a, b) =>
        String(
          b?.release_date || ""
        ).localeCompare(
          String(
            a?.release_date || ""
          )
        )
    );
  }

  if (sort === "oldest") {
    return result.sort(
      (a, b) =>
        String(
          a?.release_date || "9999"
        ).localeCompare(
          String(
            b?.release_date || "9999"
          )
        )
    );
  }

  return result;
};

const attachMovieDetailsForCountry =
  async (
    movies,
    country
  ) => {
    if (!country) {
      return movies;
    }

    /*
     * Genre + decade filtering happens
     * before this, so we only request
     * details for plausible candidates.
     */
    const candidates =
      movies.slice(0, 60);

    const enriched =
      await Promise.all(
        candidates.map(
          async (movie) => {
            try {
              const response =
                await axios.get(
                  `${TMDB_BASE}/movie/${movie.id}`,
                  {
                    params: {
                      api_key:
                        TMDB_API_KEY,
                    },
                  }
                );

              return {
                ...movie,
                origin_country:
                  response.data
                    ?.origin_country ||
                  [],
              };
            } catch (error) {
              return movie;
            }
          }
        )
      );

    return enriched.filter(
      (movie) =>
        Array.isArray(
          movie?.origin_country
        ) &&
        movie.origin_country.includes(
          country
        )
    );
  };

const discoverMovies =
  async (filters) => {
    const params = {
      api_key:
        TMDB_API_KEY,

      include_adult:
        false,

      include_video:
        false,

      page:
        1,
    };

    if (filters.genre) {
      params.with_genres =
        filters.genre;
    }

    if (filters.country) {
      params.with_origin_country =
        filters.country;
    }

    if (filters.decade) {
      params[
        "primary_release_date.gte"
      ] =
        `${filters.decade}-01-01`;

      params[
        "primary_release_date.lte"
      ] =
        `${filters.decade + 9}-12-31`;
    }

    if (filters.sort === "rating") {
      params.sort_by =
        "vote_average.desc";

      /*
       * Avoid tiny-vote 10/10 titles.
       */
      params["vote_count.gte"] =
        filters.country === "SA"
          ? 1
          : filters.country
          ? 25
          : 500;
    } else if (
      filters.sort === "newest"
    ) {
      params.sort_by =
        "primary_release_date.desc";
    } else if (
      filters.sort === "oldest"
    ) {
      params.sort_by =
        "primary_release_date.asc";
    } else {
      params.sort_by =
        "popularity.desc";
    }

    const [page1, page2] =
      await Promise.all([
        axios.get(
          `${TMDB_BASE}/discover/movie`,
          {
            params: {
              ...params,
              page: 1,
            },
          }
        ),

        axios.get(
          `${TMDB_BASE}/discover/movie`,
          {
            params: {
              ...params,
              page: 2,
            },
          }
        ),
      ]);

    const combined =
      uniqById([
        ...(
          page1.data?.results ||
          []
        ),
        ...(
          page2.data?.results ||
          []
        ),
      ]);

    const safe =
      await filterMediaSearchResults(
        combined,
        "movie"
      );

    return applyMovieSort(
      safe,
      filters.sort
    );
  };

const searchMoviesWithFilters =
  async (
    query,
    filters
  ) => {
    /*
     * No text query:
     * use TMDB Discover.
     */
    if (!query) {
      return discoverMovies(
        filters
      );
    }

    /*
     * Search more than the old 2 pages
     * whenever filters are being used,
     * otherwise a valid filtered movie
     * can disappear simply because it was
     * on page 3+ of TMDB search.
     */
    const hasFilters =
      Boolean(
        filters.genres.length ||
        filters.decade ||
        filters.countries.length ||
        filters.runtime ||
        filters.sort !==
          "relevance"
      );

    const pageCount =
      hasFilters
        ? 5
        : 2;

    const requests = [];

    for (
      let page = 1;
      page <= pageCount;
      page += 1
    ) {
      requests.push(
        axios.get(
          `${TMDB_BASE}/search/movie`,
          {
            params: {
              api_key:
                TMDB_API_KEY,

              query,

              page,

              include_adult:
                false,
            },
          }
        )
      );
    }

    const pages =
      await Promise.all(
        requests
      );

    const forceAllowed =
      await loadForceAllowedMatches(
        "movie",
        query
      );

    let combined =
      uniqById([
        ...forceAllowed,

        ...pages.flatMap(
          (response) =>
            response.data
              ?.results ||
            []
        ),
      ]);

    combined =
      combined.filter(
        (movie) =>
          movieMatchesBasicFilters(
            movie,
            filters
          )
      );

    combined =
      await attachMovieDetailsForCountry(
        combined,
        filters.country
      );

    const safe =
      await filterMediaSearchResults(
        combined,
        "movie"
      );

    return applyMovieSort(
      safe,
      filters.sort
    );
  };



/*
 * ==========================================================
 * ADVANCED MOVIE DISCOVERY V2
 *
 * Multi-select:
 *   genres
 *   countries
 *
 * Single-select:
 *   decade
 *   runtime
 *   sort
 * ==========================================================
 */

const parseCsvNumbers = (value) =>
  String(value || "")
    .split(",")
    .map((item) =>
      Number(item.trim())
    )
    .filter(
      (item) =>
        Number.isInteger(item) &&
        item > 0
    );

const parseCsvCountries = (value) =>
  [...new Set(
    String(value || "")
      .split(",")
      .map((item) =>
        item
          .trim()
          .toUpperCase()
      )
      .filter((item) =>
        /^[A-Z]{2}$/.test(
          item
        )
      )
  )];

const normalizeMovieFiltersV2 = (
  req
) => {
  const genres =
    parseCsvNumbers(
      req.query.genre
    );

  const countries =
    parseCsvCountries(
      req.query.country
    );

  const decadeRaw =
    String(
      req.query.decade || ""
    ).trim();

  const runtimeRaw =
    String(
      req.query.runtime || ""
    )
      .trim()
      .toLowerCase();

  const sortRaw =
    String(
      req.query.sort ||
      "relevance"
    )
      .trim()
      .toLowerCase();

  const decade =
    /^\d{4}$/.test(decadeRaw)
      ? Number(decadeRaw)
      : null;

  const allowedRuntimes =
    new Set([
      "under90",
      "90to120",
      "120to180",
      "over180",
    ]);

  const runtime =
    allowedRuntimes.has(
      runtimeRaw
    )
      ? runtimeRaw
      : null;

  const allowedSorts =
    new Set([
      "relevance",
      "rating",
      "newest",
      "oldest",
    ]);

  const sort =
    allowedSorts.has(sortRaw)
      ? sortRaw
      : "relevance";

  return {
    genres,
    countries,
    decade,
    runtime,
    sort,
  };
};

const movieMatchesGenreAndDecadeV2 =
  (
    movie,
    filters
  ) => {
    if (
      filters.genres.length
    ) {
      const genreIds =
        Array.isArray(
          movie?.genre_ids
        )
          ? movie.genre_ids.map(
              Number
            )
          : Array.isArray(
              movie?.genres
            )
          ? movie.genres
              .map((genre) =>
                Number(
                  genre?.id
                )
              )
              .filter(
                Number.isFinite
              )
          : [];

      /*
       * Multiple genres = AND.
       *
       * Drama + Crime means:
       * movie must contain both.
       */
      const hasEveryGenre =
        filters.genres.every(
          (genreId) =>
            genreIds.includes(
              genreId
            )
        );

      if (!hasEveryGenre) {
        return false;
      }
    }

    if (filters.decade) {
      const year =
        Number(
          String(
            movie
              ?.release_date ||
            ""
          ).slice(0, 4)
        );

      if (
        !Number.isInteger(
          year
        ) ||
        year <
          filters.decade ||
        year >
          filters.decade + 9
      ) {
        return false;
      }
    }

    return true;
  };

const movieMatchesRuntimeV2 = (
  runtime,
  filter
) => {
  const minutes =
    Number(runtime || 0);

  if (!filter) {
    return true;
  }

  if (
    !Number.isFinite(
      minutes
    ) ||
    minutes <= 0
  ) {
    return false;
  }

  if (
    filter === "under90"
  ) {
    return minutes < 90;
  }

  if (
    filter === "90to120"
  ) {
    return (
      minutes >= 90 &&
      minutes <= 120
    );
  }

  if (
    filter === "120to180"
  ) {
    return (
      minutes > 120 &&
      minutes <= 180
    );
  }

  if (
    filter === "over180"
  ) {
    return minutes > 180;
  }

  return true;
};

const applyMovieSortV2 = (
  movies,
  sort,
  query = ""
) => {
  const output = [
    ...(movies || []),
  ];

  if (sort === "rating") {
    /*
     * Best Rated rules:
     *
     * 1. < 10 votes NEVER appears.
     * 2. Rating still matters.
     * 3. Vote count has very strong
     *    influence on confidence.
     *
     * So 9.9/10 with 11 votes does
     * not beat 8.7/10 with 20,000.
     */
    return output
      .filter(
        (movie) =>
          Number(
            movie
              ?.vote_count ||
            0
          ) >= 10
      )
      .sort((a, b) => {
        const aVotes =
          Number(
            a?.vote_count ||
            0
          );

        const bVotes =
          Number(
            b?.vote_count ||
            0
          );

        const aRating =
          Number(
            a?.vote_average ||
            0
          );

        const bRating =
          Number(
            b?.vote_average ||
            0
          );

        const aScore =
          aRating *
          Math.log10(
            aVotes + 10
          );

        const bScore =
          bRating *
          Math.log10(
            bVotes + 10
          );

        if (
          bScore !== aScore
        ) {
          return (
            bScore -
            aScore
          );
        }

        return (
          bVotes -
          aVotes
        );
      });
  }

  if (sort === "newest") {
    return output.sort(
      (a, b) =>
        String(
          b?.release_date ||
          ""
        ).localeCompare(
          String(
            a?.release_date ||
            ""
          )
        )
    );
  }

  if (sort === "oldest") {
    return output.sort(
      (a, b) =>
        String(
          a?.release_date ||
          "9999"
        ).localeCompare(
          String(
            b?.release_date ||
            "9999"
          )
        )
    );
  }

  return output;
};

const enrichMovieDetailsV2 =
  async (
    movies,
    filters
  ) => {
    const needsDetails =
      filters.countries.length >
        0 ||
      Boolean(
        filters.runtime
      );

    if (!needsDetails) {
      return movies;
    }

    const candidates =
      movies.slice(0, 80);

    const enriched =
      await Promise.all(
        candidates.map(
          async (movie) => {
            try {
              const response =
                await axios.get(
                  `${TMDB_BASE}/movie/${movie.id}`,
                  {
                    params: {
                      api_key:
                        TMDB_API_KEY,
                    },
                  }
                );

              return {
                ...movie,

                origin_country:
                  response.data
                    ?.origin_country ||
                  [],

                production_countries:
                  response.data
                    ?.production_countries ||
                  [],

                runtime:
                  response.data
                    ?.runtime ??
                  movie?.runtime ??
                  null,
              };
            } catch (error) {
              return movie;
            }
          }
        )
      );

    return enriched.filter(
      (movie) => {
        if (
          filters.countries
            .length
        ) {
          const origins =
            Array.isArray(
              movie
                ?.origin_country
            )
              ? movie
                  .origin_country
              : [];

          /*
           * Multiple countries = OR.
           *
           * France + Italy means
           * films originating from
           * either selected country.
           */
          /*
           * Country filtering means PRIMARY
           * movie origin, not merely any
           * co-production / funding country.
           *
           * Example:
           * ["ID", "SA"] = Indonesian,
           * not Saudi.
           */
          const primaryOrigin =
            String(
              origins[0] || ""
            ).toUpperCase();

          const selectedCountries =
            filters.countries || [];

          const language =
            String(
              movie?.original_language || ""
            ).toLowerCase();

          const productionCountries =
            Array.isArray(
              movie?.production_countries
            )
              ? movie.production_countries
                  .map((item) =>
                    String(
                      item?.iso_3166_1 || ""
                    ).toUpperCase()
                  )
                  .filter(Boolean)
              : [];

          let countryMatch = false;

          for (
            const country of selectedCountries
          ) {
            /*
             * Scene Saudi Cinema classification:
             *
             * Saudi must actually be part of the
             * movie's identity, not merely funding.
             *
             * Arabic-language + Saudi country
             * involvement is required.
             */
            if (country === "SA") {
              /*
               * Scene Saudi Cinema:
               * use production country as the authoritative
               * classification source.
               *
               * origin_country is intentionally ignored because
               * third-party metadata can incorrectly label
               * Arabic films as Saudi.
               */
              const hasSaudiCountry =
                productionCountries.includes(
                  "SA"
                );

              if (
                language === "ar" &&
                hasSaudiCountry
              ) {
                countryMatch = true;
                break;
              }

              continue;
            }

            /*
             * Every other country uses
             * primary movie origin.
             */
            if (
              primaryOrigin ===
              country
            ) {
              countryMatch = true;
              break;
            }
          }

          if (!countryMatch) {
            return false;
          }
        }

        if (
          filters.runtime &&
          !movieMatchesRuntimeV2(
            movie?.runtime,
            filters.runtime
          )
        ) {
          return false;
        }

        return true;
      }
    );
  };

const discoverMoviesV2 =
  async (filters) => {
    const params = {
      api_key:
        TMDB_API_KEY,

      include_adult:
        false,

      include_video:
        false,
    };

    if (
      filters.genres.length
    ) {
      /*
       * TMDB comma = AND.
       */
      params.with_genres =
        filters.genres.join(
          ","
        );
    }

    if (
      filters.countries.length
    ) {
      /*
       * TMDB pipe = OR.
       */
      params.with_origin_country =
        filters.countries.join(
          "|"
        );
    }

    if (filters.decade) {
      params[
        "primary_release_date.gte"
      ] =
        `${filters.decade}-01-01`;

      params[
        "primary_release_date.lte"
      ] =
        `${
          filters.decade + 9
        }-12-31`;
    }

    if (
      filters.runtime ===
      "under90"
    ) {
      params[
        "with_runtime.lte"
      ] = 89;
    }

    if (
      filters.runtime ===
      "90to120"
    ) {
      params[
        "with_runtime.gte"
      ] = 90;

      params[
        "with_runtime.lte"
      ] = 120;
    }

    if (
      filters.runtime ===
      "120to180"
    ) {
      params[
        "with_runtime.gte"
      ] = 121;

      params[
        "with_runtime.lte"
      ] = 180;
    }

    if (
      filters.runtime ===
      "over180"
    ) {
      params[
        "with_runtime.gte"
      ] = 181;
    }

    if (
      filters.sort ===
      "rating"
    ) {
      /*
       * Universal floor.
       *
       * Saudi/local cinema can
       * still participate, but
       * one-vote entries cannot.
       */
      params[
        "vote_count.gte"
      ] = 10;

      params.sort_by =
        "vote_average.desc";
    } else if (
      filters.sort ===
      "newest"
    ) {
      params.sort_by =
        "primary_release_date.desc";
    } else if (
      filters.sort ===
      "oldest"
    ) {
      params.sort_by =
        "primary_release_date.asc";
    } else {
      params.sort_by =
        "popularity.desc";
    }

    const requests =
      [1, 2, 3].map(
        (page) =>
          axios.get(
            `${TMDB_BASE}/discover/movie`,
            {
              params: {
                ...params,
                page,
              },
            }
          )
      );

    const pages =
      await Promise.all(
        requests
      );

    let movies =
      uniqById(
        pages.flatMap(
          (response) =>
            response.data
              ?.results ||
            []
        )
      );

    movies =
      await enrichMovieDetailsV2(
        movies,
        filters
      );

    movies =
      await filterMediaSearchResults(
        movies,
        "movie"
      );

    return applyMovieSortV2(
      movies,
      filters.sort
    );
  };

const searchMoviesWithFiltersV2 =
  async (
    query,
    filters
  ) => {
    if (!query) {
      return discoverMoviesV2(
        filters
      );
    }

    const hasFilters =
      Boolean(
        filters.genres.length ||
        filters.countries
          .length ||
        filters.decade ||
        filters.runtime ||
        filters.sort !==
          "relevance"
      );

    const pageCount =
      hasFilters
        ? 5
        : 2;

    const pages =
      await Promise.all(
        Array.from(
          {
            length:
              pageCount,
          },
          (_, index) =>
            axios.get(
              `${TMDB_BASE}/search/movie`,
              {
                params: {
                  api_key:
                    TMDB_API_KEY,

                  query,

                  page:
                    index + 1,

                  include_adult:
                    false,
                },
              }
            )
        )
      );

    const forceAllowed =
      await loadForceAllowedMatches(
        "movie",
        query
      );

    let movies =
      uniqById([
        ...forceAllowed,

        ...pages.flatMap(
          (response) =>
            response.data
              ?.results ||
            []
        ),
      ]);

    movies =
      movies.filter(
        (movie) =>
          movieMatchesGenreAndDecadeV2(
            movie,
            filters
          )
      );

    movies =
      await enrichMovieDetailsV2(
        movies,
        filters
      );

    movies =
      await filterMediaSearchResults(
        movies,
        "movie"
      );

    return applyMovieSortV2(
      movies,
      filters.sort,
      query
    );
  };


/*
 * ----------------------------------------------------------
 * Movie search — backend authority
 * GET /api/search/movies?q=...
 * ----------------------------------------------------------
 */
router.get(
  "/movies",
  async (req, res) => {
    const query =
      String(
        req.query.q ||
        req.query.query ||
        ""
      ).trim();

    const filters =
      normalizeMovieFiltersV2(req);

    const hasDiscoveryFilters =
      Boolean(
        (filters.genres || []).length ||
        filters.decade ||
        (filters.countries || []).length ||
        filters.runtime ||
        filters.sort !==
          "relevance"
      );

    /*
     * Empty query is allowed when the
     * user is actively discovering via
     * filters.
     */
    if (
      !query &&
      !hasDiscoveryFilters
    ) {
      return res.status(400).json({
        message:
          "Search query or filters are required",
      });
    }

    if (
      query &&
      containsBannedWord(query)
    ) {
      return res.json([]);
    }

    try {
      const movies =
        await searchMoviesWithFiltersV2(
          query,
          filters
        );

      return res.json(
        movies.slice(0, 40)
      );
    } catch (error) {
      console.error(
        "❌ Movie search failed:",
        error.message
      );

      return res.status(500).json({
        message:
          "Movie search failed",
      });
    }
  }
);


/*
 * ----------------------------------------------------------
 * TV search — backend authority
 * GET /api/search/shows?q=...
 * ----------------------------------------------------------
 */
router.get(
  "/shows",
  async (req, res) => {
    const query =
      String(
        req.query.q ||
        req.query.query ||
        ""
      ).trim();

    if (!query) {
      return res.status(400).json({
        message:
          "Search query is required",
      });
    }

    if (
      containsBannedWord(query)
    ) {
      return res.json([]);
    }

    try {
      const shows =
        await searchTmdbMedia(
          "tv",
          query
        );

      return res.json(
        shows.slice(0, 40)
      );
    } catch (error) {
      console.error(
        "❌ TV search failed:",
        error.message
      );

      return res.status(500).json({
        message:
          "TV search failed",
      });
    }
  }
);


/*
 * ----------------------------------------------------------
 * Existing combined search endpoint
 * ----------------------------------------------------------
 */
router.get(
  "/",
  async (req, res) => {
    const query =
      String(
        req.query.q || ""
      ).trim();

    const type =
      req.query.type ||
      "all";

    if (!query) {
      return res.status(400).json({
        message:
          "Search query is required",
      });
    }

    try {
      const usersPromise =
        [
          "all",
          "users",
          "user",
        ].includes(type)
          ? User.find({
              username: {
                $regex: query,
                $options: "i",
              },
            }).limit(5)
          : Promise.resolve([]);

      const moviesPromise =
        [
          "all",
          "films",
          "movies",
        ].includes(type)
          ? searchTmdbMedia(
              "movie",
              query
            )
          : Promise.resolve([]);

      const peoplePromise =
        [
          "all",
          "people",
          "person",
        ].includes(type)
          ? axios.get(
              `${TMDB_BASE}/search/person`,
              {
                params: {
                  api_key:
                    TMDB_API_KEY,
                  query,
                },
              }
            )
          : Promise.resolve({
              data: {
                results: [],
              },
            });

      const listsPromise =
        [
          "all",
          "lists",
          "list",
        ].includes(type)
          ? List.find({
              title: {
                $regex: query,
                $options: "i",
              },

              isPrivate: false,
            })
              .limit(10)
              .populate(
                "user",
                "username"
              )
          : Promise.resolve([]);

      const [
        users,
        movies,
        peopleRes,
        lists,
      ] =
        await Promise.all([
          usersPromise,
          moviesPromise,
          peoplePromise,
          listsPromise,
        ]);

      return res.json({
        users,
        movies:
          movies.slice(0, 5),
        people:
          (
            peopleRes.data
              ?.results || []
          ).slice(0, 5),
        lists,
      });
    } catch (error) {
      console.error(
        "❌ Search failed:",
        error.message
      );

      return res.status(500).json({
        message:
          "Search failed",
      });
    }
  }
);


router.get(
  "/debug-overrides",
  async (req, res) => {
    try {
      const mongoose = require("mongoose");

      const rows =
        await MediaSearchOverride.find({})
          .lean();

      return res.json({
        database:
          mongoose.connection.name,

        count:
          rows.length,

        overrides:
          rows.map((row) => ({
            tmdbId:
              row.tmdbId,

            mediaType:
              row.mediaType,

            action:
              row.action,

            reason:
              row.reason,
          })),
      });
    } catch (error) {
      return res.status(500).json({
        message:
          error.message,
      });
    }
  }
);

module.exports = router;
