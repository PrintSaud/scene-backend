const MediaSearchOverride = require(
  "../models/mediaSearchOverride"
);

/*
 * Existing manually-blocked movie IDs.
 */
const blockedMovieIds = new Set([
  438478, 21193, 259872, 715287, 716263, 559682, 425652,
  1137047, 35712, 123338, 1305194, 452251, 80601, 288985,
  55580, 105904, 64511, 129123, 64530, 118379, 41060,
  19173, 299271, 26648, 158618, 43098, 291860, 326088,
  123587, 332291, 1252309, 116994, 410649, 11620, 499546,
  135551, 805307, 155797, 43328, 58680, 525107, 19029,
  310602, 445077, 126058, 1086548, 263132, 419590,
  559563, 367401, 77086, 69470, 180876, 571346, 256569,
  21597, 81522, 40132, 76764, 133521, 69544, 72808,
  323260, 324558, 14484, 28567, 323372, 677640, 28485,
  10497, 481, 158693, 323430, 5336, 192483, 84565,
  114587, 617932, 95757, 328662, 102497, 109863, 42446,
  41669, 57084, 11334, 61272, 29653, 769234, 87789,
  174077, 583911, 84365, 105825, 121512, 141804,
  442928, 22822, 35718, 27, 40652, 179387, 151586,
  322305, 105789, 346536, 20712, 113776, 49714, 59979,
  517929, 829557, 664413, 365592, 418578, 221913,
  21484, 36954, 830884, 247136, 197158, 46697, 173705,
  58008, 340540,
]);

const whitelistedMovieIds = new Set([
  76492,
  109445,
  159824,
  330459,
  705996,
]);

const bannedWords = [
  "porn",
  "porno",
  "pornography",
  "hentai",
  "xxx",
  "fetish",
  "bdsm",
  "shemale",
  "rape",
  "incest",
  "orgy",
  "milf",
  "slut",
  "whore",
  "kamasutra",
  "playboy",
  "sex",
  "erotic",
  "erotica",
  "av idol",
  "adult video",
];

const riskyAsianLanguages =
  new Set(["ja", "zh", "ko"]);

const escapeRegExp = (value) =>
  String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );

const containsBannedWord = (value) => {
  const normalized =
    String(value || "").toLowerCase();

  return bannedWords.some((word) => {
    const pattern = new RegExp(
      `(^|[^a-z0-9])${escapeRegExp(word)}([^a-z0-9]|$)`,
      "i"
    );

    return pattern.test(normalized);
  });
};

const getId = (item) =>
  Number(
    item?.id ??
    item?.tmdbId
  );

const getLanguage = (item) =>
  String(
    item?.original_language ??
    item?.originalLanguage ??
    ""
  ).toLowerCase();

const getTitle = (item, mediaType) =>
  String(
    mediaType === "tv"
      ? (
          item?.name ||
          item?.original_name ||
          item?.title ||
          ""
        )
      : (
          item?.title ||
          item?.original_title ||
          ""
        )
  );

const hasPoster = (item) =>
  Boolean(
    item?.poster ||
    item?.poster_path ||
    item?.posterPath
  );

const basicSafetyPass = (
  item,
  mediaType
) => {
  const id = getId(item);

  if (
    mediaType === "movie" &&
    blockedMovieIds.has(id)
  ) {
    return false;
  }

  if (!hasPoster(item)) {
    return false;
  }

  if (item?.adult === true) {
    return false;
  }

  const title =
    getTitle(
      item,
      mediaType
    );

  const overview =
    String(
      item?.overview || ""
    );

  if (
    containsBannedWord(title) ||
    containsBannedWord(overview)
  ) {
    return false;
  }

  const lang =
    getLanguage(item);

  const voteCount =
    Number(
      item?.vote_count ??
      item?.voteCount ??
      0
    );

  const popularity =
    Number(
      item?.popularity || 0
    );

  const isArabic =
    lang === "ar";

  const isSaudi =
    Array.isArray(
      item?.origin_country
    ) &&
    item.origin_country.includes(
      "SA"
    );

  /*
   * Protect Arabic / Saudi content from
   * global popularity thresholds.
   */
  if (
    isArabic ||
    isSaudi
  ) {
    return true;
  }

  /*
   * Extra anti-junk protection for JA/ZH/KO.
   *
   * IMPORTANT:
   * This is intentionally much softer than
   * the old 5,000-vote requirement.
   *
   * We reject only extremely low-signal entries.
   */
  if (
    riskyAsianLanguages.has(lang) &&
    voteCount < 10 &&
    popularity < 2
  ) {
    return false;
  }

  /*
   * Generic dead-entry protection.
   *
   * A legitimate niche/new title can still pass.
   */
  if (
    voteCount === 0 &&
    popularity < 0.5 &&
    overview.trim().length < 20
  ) {
    return false;
  }

  return true;
};

const loadOverrides = async (
  items,
  mediaType
) => {
  const ids =
    [...new Set(
      items
        .map(getId)
        .filter(
          (id) =>
            Number.isInteger(id) &&
            id > 0
        )
    )];

  if (!ids.length) {
    return new Map();
  }

  const rows =
    await MediaSearchOverride.find({
      mediaType,
      tmdbId: {
        $in: ids,
      },
    })
      .lean();

  return new Map(
    rows.map(
      (row) => [
        Number(row.tmdbId),
        row.action,
      ]
    )
  );
};

const filterMediaSearchResults =
  async (
    items,
    mediaType
  ) => {
    if (!Array.isArray(items)) {
      return [];
    }

    const overrides =
      await loadOverrides(
        items,
        mediaType
      );

    return items.filter((item) => {
      const id =
        getId(item);

      const override =
        overrides.get(id);

      /*
       * Explicit block wins over everything.
       */
      if (override === "block") {
        return false;
      }

      /*
       * Explicit allow skips normal thresholds,
       * but NEVER bypasses TMDB adult=true or
       * explicit sexual-term safety filtering.
       */
      if (override === "allow") {
        if (item?.adult === true) {
          return false;
        }

        const title =
          getTitle(
            item,
            mediaType
          );

        const overview =
          String(
            item?.overview || ""
          );

        if (
          containsBannedWord(title) ||
          containsBannedWord(overview)
        ) {
          return false;
        }

        return true;
      }

      if (
        mediaType === "movie" &&
        whitelistedMovieIds.has(id)
      ) {
        return true;
      }

      return basicSafetyPass(
        item,
        mediaType
      );
    });
  };

module.exports = {
  filterMediaSearchResults,
  containsBannedWord,
};
