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
      const movies =
        await searchTmdbMedia(
          "movie",
          query
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
