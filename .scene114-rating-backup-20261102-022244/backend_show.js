// src/routes/showReviewRoutes.js

const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const protect = require(
  "../middleware/authMiddleware"
);

const sendNotification = require(
    "../utils/sendNotification"
  );

const ShowReview = require(
  "../models/showReview"
);

const Show = require(
  "../models/showModel"
);

const User = require(
  "../models/user"
);

// ======================================================
// Constants
// ======================================================

const DEFAULT_LIMIT = 20;
const MAXIMUM_LIMIT = 50;

const VALID_SORTS = new Set([
  "newest",
  "oldest",
  "highest",
  "lowest",
  "most-liked",
]);

// ======================================================
// Helpers
// ======================================================

function getAuthenticatedUserId(req) {
  return (
    req.user?._id ||
    req.user?.id ||
    null
  );
}

function parsePositiveInteger(
  value,
  fieldName = "ID"
) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 1
  ) {
    const error = new Error(
      `Invalid ${fieldName}`
    );

    error.statusCode = 400;

    throw error;
  }

  return parsed;
}

function parseLimit(
  value,
  fallback = DEFAULT_LIMIT
) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 1
  ) {
    return fallback;
  }

  return Math.min(
    parsed,
    MAXIMUM_LIMIT
  );
}

function parsePage(value) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 1
  ) {
    return 1;
  }

  return parsed;
}

function normalizeString(
  value,
  maximumLength = 20000
) {
  if (
    typeof value !== "string"
  ) {
    return "";
  }

  return value
    .trim()
    .slice(0, maximumLength);
}

function normalizeRating(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const rating = Number(value);

  if (
    !Number.isFinite(rating) ||
    rating < 0.5 ||
    rating > 5 ||
    !Number.isInteger(
      rating * 2
    )
  ) {
    const error = new Error(
      "Rating must use half-star increments between 0.5 and 5"
    );

    error.statusCode = 400;

    throw error;
  }

  return rating;
}

function normalizeImages(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .filter(
          (item) =>
            typeof item ===
            "string"
        )
        .map((item) =>
          item.trim()
        )
        .filter(Boolean)
    ),
  ].slice(0, 10);
}

function normalizeFavoriteCharacter(
  value
) {
  if (
    !value ||
    typeof value !==
      "object"
  ) {
    return null;
  }

  const character = {
    actorId:
      Number.isFinite(
        Number(value.actorId)
      )
        ? Number(value.actorId)
        : null,

    creditId:
      normalizeString(
        value.creditId,
        500
      ),

    characterName:
      normalizeString(
        value.characterName,
        500
      ),

    actorName:
      normalizeString(
        value.actorName,
        500
      ),

    profilePath:
      normalizeString(
        value.profilePath,
        2000
      ),
  };

  const hasData = Boolean(
    character.actorId !== null ||
      character.creditId ||
      character.characterName ||
      character.actorName ||
      character.profilePath
  );

  return hasData
    ? character
    : null;
}

function hasReviewContent(input) {
  return Boolean(
    normalizeRating(
      input.rating
    ) !== null ||
      normalizeString(
        input.review
      ) ||
      normalizeString(
        input.gif
      ) ||
      normalizeString(
        input.image
      ) ||
      normalizeImages(
        input.images
      ).length > 0
  );
}

function includesObjectId(
  values,
  userId
) {
  return Array.isArray(values)
    ? values.some(
        (value) =>
          String(
            value?._id ||
            value
          ) ===
          String(userId)
      )
    : false;
}

function removeObjectId(
  values,
  userId
) {
  return (
    Array.isArray(values)
      ? values
      : []
  ).filter(
    (value) =>
      String(
        value?._id ||
        value
      ) !==
      String(userId)
  );
}

function getTeamTag(
  favoriteCharacter
) {
  const characterName =
    favoriteCharacter
      ?.characterName;

  if (
    typeof characterName !==
      "string" ||
    !characterName.trim()
  ) {
    return null;
  }

  const normalized =
    characterName
      .trim()
      .replace(/\s+/g, "");

  return normalized
    ? `#Team${normalized}`
    : null;
}

async function enrichRepliesWithReviewerShowData(
  reviews,
  showTmdbId
) {
  const reviewList =
    Array.isArray(reviews)
      ? reviews
      : reviews
      ? [reviews]
      : [];

  if (
    reviewList.length === 0 ||
    !showTmdbId
  ) {
    return reviews;
  }

  const replyUserIds = [
    ...new Set(
      reviewList
        .flatMap(
          (review) =>
            Array.isArray(
              review?.replies
            )
              ? review.replies
              : []
        )
        .map(
          (reply) =>
            reply?.user?._id ||
            reply?.user?.id ||
            reply?.user
        )
        .filter(Boolean)
        .map(String)
    ),
  ];

  if (
    replyUserIds.length === 0
  ) {
    return reviews;
  }

  const reviewerReviews =
    await ShowReview.find({
      showTmdbId,
      user: {
        $in: replyUserIds,
      },
    })
      .select(
        "user rating favoriteCharacter"
      )
      .lean();

  const reviewerReviewMap =
    new Map(
      reviewerReviews.map(
        (review) => [
          String(review.user),
          {
            rating:
              review.rating ??
              null,

            favoriteCharacter:
              review.favoriteCharacter ||
              null,

            teamTag:
              getTeamTag(
                review.favoriteCharacter
              ),
          },
        ]
      )
    );

  reviewList.forEach(
    (review) => {
      if (
        !Array.isArray(
          review?.replies
        )
      ) {
        return;
      }

      review.replies.forEach(
        (reply) => {
          const replyUserId =
            reply?.user?._id ||
            reply?.user?.id ||
            reply?.user;

          const reviewerReview =
            reviewerReviewMap.get(
              String(replyUserId)
            );

          reply.rating =
            reviewerReview?.rating ??
            null;

          reply.favoriteCharacter =
            reviewerReview
              ?.favoriteCharacter ||
            null;

          reply.teamTag =
            reviewerReview?.teamTag ||
            null;
        }
      );
    }
  );

  return reviews;
}

function buildReviewSort(sortType) {
  switch (sortType) {
    case "oldest":
      return {
        createdAt: 1,
        _id: 1,
      };

    case "highest":
      return {
        rating: -1,
        updatedAt: -1,
      };

    case "lowest":
      return {
        rating: 1,
        updatedAt: -1,
      };

    case "newest":
    default:
      return {
        updatedAt: -1,
        createdAt: -1,
        _id: -1,
      };
  }
}

function serializeReply(
  reply,
  viewerUserId = null
) {
  const populatedUser =
    reply.user &&
    typeof reply.user ===
      "object" &&
    reply.user._id
      ? reply.user
      : null;

  return {
    id: String(reply._id),

    user: {
      id: populatedUser
        ? String(
            populatedUser._id
          )
        : String(reply.user),

      username:
        populatedUser?.username ||
        "",

      name:
        populatedUser?.name ||
        "",

      avatar:
        populatedUser?.avatar ||
        "",
    },

    text:
      reply.text || "",

    gif:
      reply.gif || "",

    image:
      reply.image || "",

    rating:
      reply.rating ??
      null,

    favoriteCharacter:
      reply.favoriteCharacter ||
      null,

    teamTag:
      reply.teamTag ||
      getTeamTag(
        reply.favoriteCharacter
      ),

    parentComment:
      reply.parentComment
        ? String(
            reply.parentComment
          )
        : null,

    likeCount:
      Array.isArray(
        reply.likes
      )
        ? reply.likes.length
        : 0,

    likedByViewer:
      viewerUserId
        ? includesObjectId(
            reply.likes,
            viewerUserId
          )
        : false,

    createdAt:
      reply.createdAt || null,

    updatedAt:
      reply.updatedAt || null,
  };
}

function serializeReview(
  review,
  viewerUserId = null
) {
  const populatedUser =
    review.user &&
    typeof review.user ===
      "object" &&
    review.user._id
      ? review.user
      : null;

  const replies =
    Array.isArray(
      review.replies
    )
      ? review.replies
      : [];

  return {
    id: String(review._id),

    user: {
      id: populatedUser
        ? String(
            populatedUser._id
          )
        : String(review.user),

      username:
        populatedUser?.username ||
        "",

      name:
        populatedUser?.name ||
        "",

      avatar:
        populatedUser?.avatar ||
        "",
    },

    show: {
      id: review.show
        ? String(
            review.show
          )
        : null,

      tmdbId:
        review.showTmdbId,

      name:
        review.showName || "",

      nameAr:
        review.showNameAr || "",

      posterPath:
        review.showPoster || "",

      backdropPath:
        review.showBackdrop || "",

      displayBackdrop:
        review.customBackdrop ||
        review.showBackdrop ||
        "",

      firstAirDate:
        review.firstAirDate || "",
    },

    rating:
      review.rating ?? null,

    review:
      review.review || "",

    containsSpoilers:
      Boolean(
        review.containsSpoilers
      ),

    customBackdrop:
      review.customBackdrop ||
      "",

    media: {
      gif:
        review.gif || "",

      image:
        review.image || "",

      images:
        Array.isArray(
          review.images
        )
          ? review.images
          : [],
    },

    favoriteCharacter:
      review.favoriteCharacter ||
      null,

    teamTag:
      getTeamTag(
        review.favoriteCharacter
      ),

    engagement: {
      likeCount:
        Array.isArray(
          review.likes
        )
          ? review.likes.length
          : 0,

      replyCount:
        replies.length,

      likedByViewer:
        viewerUserId
          ? includesObjectId(
              review.likes,
              viewerUserId
            )
          : false,
    },

    replies:
      replies.map((reply) =>
        serializeReply(
          reply,
          viewerUserId
        )
      ),

    permissions: {
      canEdit:
        viewerUserId
          ? String(
              populatedUser?._id ||
              review.user
            ) ===
            String(
              viewerUserId
            )
          : false,

      canDelete:
        viewerUserId
          ? String(
              populatedUser?._id ||
              review.user
            ) ===
            String(
              viewerUserId
            )
          : false,
    },

    source:
      review.source ||
      "manual",

    createdAt:
      review.createdAt || null,

    updatedAt:
      review.updatedAt || null,

    navigation: {
      screen: "ShowReview",

      params: {
        reviewId:
          String(review._id),

        showTmdbId:
          review.showTmdbId,
      },
    },
  };
}

async function populateReviewDocument(
  review
) {
  await review.populate(
    "user",
    "username name avatar"
  );

  await review.populate(
    "replies.user",
    "username name avatar"
  );

  return review;
}

function handleError(
  error,
  res,
  fallbackMessage
) {
  console.error(
    `❌ ${fallbackMessage}:`,
    error?.stack || error
  );

  if (
    error?.code === 11000
  ) {
    return res.status(409).json({
      error:
        "A review for this show already exists",
    });
  }

  const statusCode =
    Number(
      error?.statusCode
    ) || 500;

  return res
    .status(statusCode)
    .json({
      error:
        statusCode < 500
          ? error.message
          : fallbackMessage,

      details:
        process.env.NODE_ENV ===
        "production"
          ? undefined
          : error?.message ||
            undefined,
    });
}

// ======================================================
// GET /api/show-reviews/show/:showTmdbId/summary
//
// Rating average and distribution.
// ======================================================

router.get(
  "/show/:showTmdbId/summary",
  async (req, res) => {
    try {
      const showTmdbId =
        parsePositiveInteger(
          req.params.showTmdbId,
          "show ID"
        );

      const [
        ratingSummary,
        reviewCount,
      ] = await Promise.all([
        ShowReview.aggregate([
          {
            $match: {
              showTmdbId,

              rating: {
                $ne: null,
              },
            },
          },

          {
            $group: {
              _id: "$rating",

              count: {
                $sum: 1,
              },
            },
          },

          {
            $sort: {
              _id: 1,
            },
          },
        ]),

        ShowReview.countDocuments({
          showTmdbId,
        }),
      ]);

      const distribution = {};

      let ratedCount = 0;
      let ratingTotal = 0;

      for (
        let rating = 0.5;
        rating <= 5;
        rating += 0.5
      ) {
        distribution[
          rating.toFixed(1)
        ] = 0;
      }

      for (
        const item of ratingSummary
      ) {
        const rating =
          Number(item._id);

        const count =
          Number(item.count) || 0;

        if (
          Number.isFinite(
            rating
          )
        ) {
          distribution[
            rating.toFixed(1)
          ] = count;

          ratedCount += count;
          ratingTotal +=
            rating * count;
        }
      }

      return res.status(200).json({
        showTmdbId,

        reviewCount,

        ratedCount,

        averageRating:
          ratedCount > 0
            ? Math.round(
                (
                  ratingTotal /
                  ratedCount
                ) * 100
              ) / 100
            : null,

        distribution,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch show review summary"
      );
    }
  }
);


// ======================================================
// GET /api/show-reviews/show/:showTmdbId/friends
//
// Reviews and ratings from users the current user follows.
//
// Query:
// - page=1
// - limit=20
// - sort=newest|oldest|highest|lowest|most-liked
// ======================================================

router.get(
  "/show/:showTmdbId/friends",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const showTmdbId =
        parsePositiveInteger(
          req.params.showTmdbId,
          "show ID"
        );

      const page =
        parsePage(req.query.page);

      const limit =
        parseLimit(req.query.limit);

      const requestedSort =
        typeof req.query.sort === "string"
          ? req.query.sort
          : "newest";

      const sortType =
        VALID_SORTS.has(requestedSort)
          ? requestedSort
          : "newest";

      const currentUser =
        await User.findById(userId)
          .select("following")
          .lean();

      if (!currentUser) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      const following =
        Array.isArray(currentUser.following)
          ? currentUser.following
          : [];

      if (!following.length) {
        return res.status(200).json({
          showTmdbId,
          results: [],
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 0,
            hasMore: false,
          },
          sort: sortType,
        });
      }

      const match = {
        showTmdbId,
        user: {
          $in: following,
        },
      };

      let reviews = [];
      let total = 0;

      if (sortType === "most-liked") {
        const sortedResults =
          await ShowReview.aggregate([
            {
              $match: match,
            },
            {
              $addFields: {
                likeCount: {
                  $size: {
                    $ifNull: [
                      "$likes",
                      [],
                    ],
                  },
                },
              },
            },
            {
              $sort: {
                likeCount: -1,
                updatedAt: -1,
                _id: -1,
              },
            },
            {
              $skip:
                (page - 1) * limit,
            },
            {
              $limit: limit,
            },
          ]);

        const reviewIds =
          sortedResults.map(
            (review) => review._id
          );

        const populatedReviews =
          await ShowReview.find({
            _id: {
              $in: reviewIds,
            },
          })
            .populate(
              "user",
              "username name avatar"
            )
            .populate(
              "replies.user",
              "username name avatar"
            )
            .lean({
              virtuals: true,
            });

        const reviewMap =
          new Map(
            populatedReviews.map(
              (review) => [
                String(review._id),
                review,
              ]
            )
          );

        reviews =
          reviewIds
            .map((reviewId) =>
              reviewMap.get(
                String(reviewId)
              )
            )
            .filter(Boolean);

        total =
          await ShowReview.countDocuments(
            match
          );
      } else {
        [
          reviews,
          total,
        ] = await Promise.all([
          ShowReview.find(match)
            .sort(
              buildReviewSort(sortType)
            )
            .skip(
              (page - 1) * limit
            )
            .limit(limit)
            .populate(
              "user",
              "username name avatar"
            )
            .populate(
              "replies.user",
              "username name avatar"
            )
            .lean({
              virtuals: true,
            }),

          ShowReview.countDocuments(
            match
          ),
        ]);
      }

      await enrichRepliesWithReviewerShowData(
        reviews,
        showTmdbId
      );

      return res.status(200).json({
        showTmdbId,

        results:
          reviews.map((review) =>
            serializeReview(
              review,
              userId
            )
          ),

        pagination: {
          page,
          limit,
          total,

          totalPages:
            Math.ceil(total / limit),

          hasMore:
            page * limit < total,
        },

        sort: sortType,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch friends’ show reviews"
      );
    }
  }
);

// ======================================================
// GET /api/show-reviews/show/:showTmdbId
//
// Public reviews for one show.
//
// Query:
// - page=1
// - limit=20
// - sort=newest|oldest|highest|lowest|most-liked
// ======================================================

router.get(
  "/show/:showTmdbId",
  async (req, res) => {
    try {
      const showTmdbId =
        parsePositiveInteger(
          req.params.showTmdbId,
          "show ID"
        );

      const page =
        parsePage(
          req.query.page
        );

      const limit =
        parseLimit(
          req.query.limit
        );

      const requestedSort =
        typeof req.query.sort ===
          "string"
          ? req.query.sort
          : "newest";

      const sortType =
        VALID_SORTS.has(
          requestedSort
        )
          ? requestedSort
          : "newest";

      const match = {
        showTmdbId,
      };

      let reviews;
      let total;

      if (
        sortType ===
        "most-liked"
      ) {
        const results =
          await ShowReview.aggregate([
            {
              $match:
                match,
            },

            {
              $addFields: {
                likeCount: {
                  $size: {
                    $ifNull: [
                      "$likes",
                      [],
                    ],
                  },
                },
              },
            },

            {
              $sort: {
                likeCount: -1,
                updatedAt: -1,
                _id: -1,
              },
            },

            {
              $skip:
                (page - 1) *
                limit,
            },

            {
              $limit: limit,
            },
          ]);

        const reviewIds =
          results.map(
            (item) =>
              item._id
          );

        const populated =
          await ShowReview.find({
            _id: {
              $in: reviewIds,
            },
          })
            .populate(
              "user",
              "username name avatar"
            )
            .populate(
              "replies.user",
              "username name avatar"
            )
            .lean({
              virtuals: true,
            });

        const reviewMap =
          new Map(
            populated.map(
              (review) => [
                String(
                  review._id
                ),
                review,
              ]
            )
          );

        reviews =
          reviewIds
            .map((id) =>
              reviewMap.get(
                String(id)
              )
            )
            .filter(Boolean);

        total =
          await ShowReview.countDocuments(
            match
          );
      } else {
        [
          reviews,
          total,
        ] = await Promise.all([
          ShowReview.find(
            match
          )
            .sort(
              buildReviewSort(
                sortType
              )
            )
            .skip(
              (page - 1) *
                limit
            )
            .limit(limit)
            .populate(
              "user",
              "username name avatar"
            )
            .populate(
              "replies.user",
              "username name avatar"
            )
            .lean({
              virtuals: true,
            }),

          ShowReview.countDocuments(
            match
          ),
        ]);
      }

      await enrichRepliesWithReviewerShowData(
        reviews,
        showTmdbId
      );

      return res.status(200).json({
        showTmdbId,

        results:
          reviews.map(
            (review) =>
              serializeReview(
                review
              )
          ),

        pagination: {
          page,
          limit,
          total,

          totalPages:
            Math.ceil(
              total / limit
            ),

          hasMore:
            page * limit <
            total,
        },

        sort:
          sortType,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch show reviews"
      );
    }
  }
);

// ======================================================
// GET /api/show-reviews/my/:showTmdbId
//
// Current user's one review for a show.
// ======================================================

router.get(
  "/my/:showTmdbId",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const showTmdbId =
        parsePositiveInteger(
          req.params.showTmdbId,
          "show ID"
        );

      const review =
        await ShowReview.findOne({
          user: userId,
          showTmdbId,
        })
          .populate(
            "user",
            "username name avatar"
          )
          .populate(
            "replies.user",
            "username name avatar"
          )
          .lean({
            virtuals: true,
          });

      return res.status(200).json({
        showTmdbId,

        hasReview:
          Boolean(review),

        review:
          review
            ? serializeReview(
                review,
                userId
              )
            : null,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch your show review"
      );
    }
  }
);

// ======================================================
// POST /api/show-reviews
//
// Create the current user's one review for a show.
// ======================================================

router.post(
  "/",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const showTmdbId =
        parsePositiveInteger(
          req.body?.showTmdbId,
          "show ID"
        );

      if (
        !hasReviewContent(
          req.body || {}
        )
      ) {
        return res.status(400).json({
          error:
            "A show review requires a rating, review, GIF, or image",
        });
      }

      const existing =
        await ShowReview.findOne({
          user: userId,
          showTmdbId,
        })
          .select("_id")
          .lean();

      if (existing) {
        return res.status(409).json({
          error:
            "You already reviewed this show",

          reviewId:
            String(
              existing._id
            ),
        });
      }

      const localShow =
        await Show.findOne({
          tmdbId:
            showTmdbId,
        }).lean();

      if (!localShow) {
        return res.status(404).json({
          error:
            "Show metadata not found. Open the show page before reviewing it.",
        });
      }

      const images =
        normalizeImages(
          req.body?.images
        );

      const image =
        normalizeString(
          req.body?.image,
          2000
        ) ||
        images[0] ||
        "";

      if (
        image &&
        !images.includes(image)
      ) {
        images.unshift(image);
      }

      const review =
        await ShowReview.create({
          user: userId,

          show:
            localShow._id,

          showTmdbId,

          showName:
            localShow.name ||
            "Untitled Show",

          showNameAr:
            localShow.nameAr ||
            "",

          showPoster:
            localShow.posterPath ||
            "",

          showBackdrop:
            localShow.backdropPath ||
            "",

          firstAirDate:
            localShow.firstAirDate
              ? new Date(
                  localShow.firstAirDate
                )
                  .toISOString()
                  .slice(0, 10)
              : "",

          rating:
            normalizeRating(
              req.body?.rating
            ),

          review:
            normalizeString(
              req.body?.review,
              20000
            ),

          containsSpoilers:
            req.body
              ?.containsSpoilers ===
            true,

          customBackdrop:
            normalizeString(
              req.body
                ?.customBackdrop,
              2000
            ),

          gif:
            normalizeString(
              req.body?.gif,
              2000
            ),

          image,
          images,

          favoriteCharacter:
            normalizeFavoriteCharacter(
              req.body
                ?.favoriteCharacter
            ),

          likes: [],
          replies: [],

          source: "manual",
        });

      await populateReviewDocument(
        review
      );

      return res.status(201).json({
        message:
          "Show review created",

        review:
          serializeReview(
            review.toObject({
              virtuals: true,
            }),
            userId
          ),
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to create show review"
      );
    }
  }
);

// ======================================================
// GET /api/show-reviews/:reviewId
//
// Public one-review page.
// ======================================================

router.get(
  "/:reviewId",
  async (req, res) => {
    try {
      if (
        !mongoose.isValidObjectId(
          req.params.reviewId
        )
      ) {
        return res.status(400).json({
          error:
            "Invalid review ID",
        });
      }

      const review =
        await ShowReview.findById(
          req.params.reviewId
        )
          .populate(
            "user",
            "username name avatar"
          )
          .populate(
            "replies.user",
            "username name avatar"
          )
          .lean({
            virtuals: true,
          });

      if (!review) {
        return res.status(404).json({
          error:
            "Show review not found",
        });
      }

      await enrichRepliesWithReviewerShowData(
        review,
        review.showTmdbId
      );

      return res.status(200).json({
        review:
          serializeReview(
            review
          ),
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch show review"
      );
    }
  }
);

// ======================================================
// PATCH /api/show-reviews/:reviewId
//
// Owner only.
// ======================================================

router.patch(
  "/:reviewId",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      if (
        !mongoose.isValidObjectId(
          req.params.reviewId
        )
      ) {
        return res.status(400).json({
          error:
            "Invalid review ID",
        });
      }

      const review =
        await ShowReview.findById(
          req.params.reviewId
        );

      if (!review) {
        return res.status(404).json({
          error:
            "Show review not found",
        });
      }

      if (
        String(review.user) !==
        String(userId)
      ) {
        return res.status(403).json({
          error:
            "You cannot edit this show review",
        });
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "rating"
        )
      ) {
        review.rating =
          normalizeRating(
            req.body.rating
          );
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "review"
        )
      ) {
        review.review =
          normalizeString(
            req.body.review,
            20000
          );
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "containsSpoilers"
        )
      ) {
        review.containsSpoilers =
          req.body
            .containsSpoilers ===
          true;
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "customBackdrop"
        )
      ) {
        review.customBackdrop =
          normalizeString(
            req.body
              .customBackdrop,
            2000
          );
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "gif"
        )
      ) {
        review.gif =
          normalizeString(
            req.body.gif,
            2000
          );
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "image"
        )
      ) {
        review.image =
          normalizeString(
            req.body.image,
            2000
          );
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "images"
        )
      ) {
        review.images =
          normalizeImages(
            req.body.images
          );
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "favoriteCharacter"
        )
      ) {
        review.favoriteCharacter =
          normalizeFavoriteCharacter(
            req.body
              .favoriteCharacter
          );
      }

      await review.save();

      await populateReviewDocument(
        review
      );

      return res.status(200).json({
        message:
          "Show review updated",

        review:
          serializeReview(
            review.toObject({
              virtuals: true,
            }),
            userId
          ),
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to update show review"
      );
    }
  }
);

// ======================================================
// DELETE /api/show-reviews/:reviewId
//
// Owner only.
// ======================================================

router.delete(
  "/:reviewId",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const review =
        await ShowReview.findById(
          req.params.reviewId
        );

      if (!review) {
        return res.status(404).json({
          error:
            "Show review not found",
        });
      }

      if (
        String(review.user) !==
        String(userId)
      ) {
        return res.status(403).json({
          error:
            "You cannot delete this show review",
        });
      }

      await review.deleteOne();

      return res.status(200).json({
        message:
          "Show review deleted",

        reviewId:
          req.params.reviewId,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to delete show review"
      );
    }
  }
);

// ======================================================
// POST /api/show-reviews/:reviewId/like
//
// Toggle review like.
// ======================================================

// ======================================================
// POST /api/show-reviews/:reviewId/like
//
// Toggle review like.
// Sends a notification only when a new like is added.
// ======================================================

router.post(
    "/:reviewId/like",
    protect,
    async (req, res) => {
      try {
        const userId =
          getAuthenticatedUserId(req);
  
        if (
          !mongoose.isValidObjectId(
            req.params.reviewId
          )
        ) {
          return res.status(400).json({
            error:
              "Invalid review ID",
          });
        }
  
        const review =
          await ShowReview.findById(
            req.params.reviewId
          );
  
        if (!review) {
          return res.status(404).json({
            error:
              "Show review not found",
          });
        }
  
        const alreadyLiked =
          includesObjectId(
            review.likes,
            userId
          );
  
        if (alreadyLiked) {
          review.likes =
            removeObjectId(
              review.likes,
              userId
            );
        } else {
          review.likes.push(
            userId
          );
        }
  
        await review.save();
  
        if (!alreadyLiked) {
          await sendNotification({
            type:
              "show_review_like",
  
            fromUserId:
              userId,
  
            toUserId:
              review.user,
  
            mediaType:
              "tv",
  
            targetType:
              "showReview",
  
            showId:
              String(
                review.showTmdbId
              ),
  
            showTitle:
              review.showName || "",
  
            showPoster:
              review.showPoster || "",
  
            showBackdrop:
              review.showBackdrop || "",
  
            showReviewId:
              review._id,
  
            relatedId:
              String(
                review._id
              ),
  
            deduplicationKey:
              `show-review-like:${review._id}:${userId}`,
  
            metadata: {
              action:
                "like",
  
              reviewOwnerId:
                String(
                  review.user
                ),
            },
          });
        }
  
        return res.status(200).json({
          liked:
            !alreadyLiked,
  
          likeCount:
            review.likes.length,
        });
      } catch (error) {
        return handleError(
          error,
          res,
          "Failed to like show review"
        );
      }
    }
  );

// ======================================================
// POST /api/show-reviews/:reviewId/replies
//
// Add top-level comment or nested reply.
//
// Notification behavior:
// - Top-level comment notifies the review owner.
// - Nested reply notifies the parent-comment author.
// - If the parent author is the current user, falls back to
//   notifying the review owner.
// ======================================================

router.post(
    "/:reviewId/replies",
    protect,
    async (req, res) => {
      try {
        const userId =
          getAuthenticatedUserId(req);
  
        if (
          !mongoose.isValidObjectId(
            req.params.reviewId
          )
        ) {
          return res.status(400).json({
            error:
              "Invalid review ID",
          });
        }
  
        const review =
          await ShowReview.findById(
            req.params.reviewId
          );
  
        if (!review) {
          return res.status(404).json({
            error:
              "Show review not found",
          });
        }
  
        const text =
          normalizeString(
            req.body?.text,
            5000
          );
  
        const gif =
          normalizeString(
            req.body?.gif,
            2000
          );
  
        const image =
          normalizeString(
            req.body?.image,
            2000
          );
  
        if (
          !text &&
          !gif &&
          !image
        ) {
          return res.status(400).json({
            error:
              "A reply requires text, GIF, or image",
          });
        }
  
        let parentComment =
          null;
  
        let parentReply =
          null;
  
        if (
          req.body?.parentComment
        ) {
          if (
            !mongoose.isValidObjectId(
              req.body
                .parentComment
            )
          ) {
            return res.status(400).json({
              error:
                "Invalid parent comment ID",
            });
          }
  
          parentReply =
            review.replies.id(
              req.body
                .parentComment
            );
  
          if (!parentReply) {
            return res.status(404).json({
              error:
                "Parent comment not found",
            });
          }
  
          parentComment =
            parentReply._id;
        }
  
        review.replies.push({
          user:
            userId,
  
          text,
          gif,
          image,
  
          likes: [],
  
          parentComment,
        });
  
        await review.save();
  
        const createdReply =
          review.replies[
            review.replies.length - 1
          ];
  
        let recipientUserId =
          review.user;
  
        if (
          parentReply &&
          String(
            parentReply.user
          ) !==
            String(userId)
        ) {
          recipientUserId =
            parentReply.user;
        }
  
        await sendNotification({
          type:
            "show_review_comment",
  
          fromUserId:
            userId,
  
          toUserId:
            recipientUserId,
  
          mediaType:
            "tv",
  
          targetType:
            "showReview",
  
          showId:
            String(
              review.showTmdbId
            ),
  
          showTitle:
            review.showName || "",
  
          showPoster:
            review.showPoster || "",
  
          showBackdrop:
            review.showBackdrop || "",
  
          showReviewId:
            review._id,
  
          relatedId:
            String(
              createdReply._id
            ),
  
          metadata: {
            action:
              parentReply
                ? "nested_reply"
                : "comment",
  
            replyId:
              String(
                createdReply._id
              ),
  
            parentCommentId:
              parentComment
                ? String(
                    parentComment
                  )
                : "",
  
            reviewId:
              String(
                review._id
              ),
          },
        });
  
        await review.populate(
          "replies.user",
          "username name avatar"
        );
  
        const populatedReply =
          review.replies.id(
            createdReply._id
          );
  
        return res.status(201).json({
          message:
            "Reply added",
  
          reply:
            serializeReply(
              populatedReply,
              userId
            ),
  
          replyCount:
            review.replies.length,
        });
      } catch (error) {
        return handleError(
          error,
          res,
          "Failed to add reply"
        );
      }
    }
  );

// ======================================================
// DELETE /api/show-reviews/:reviewId/replies/:replyId
//
// Reply author or review owner may delete.
// Also deletes nested replies pointing to this reply.
// ======================================================

router.delete(
  "/:reviewId/replies/:replyId",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const review =
        await ShowReview.findById(
          req.params.reviewId
        );

      if (!review) {
        return res.status(404).json({
          error:
            "Show review not found",
        });
      }

      const reply =
        review.replies.id(
          req.params.replyId
        );

      if (!reply) {
        return res.status(404).json({
          error:
            "Reply not found",
        });
      }

      const ownsReply =
        String(reply.user) ===
        String(userId);

      const ownsReview =
        String(review.user) ===
        String(userId);

      if (
        !ownsReply &&
        !ownsReview
      ) {
        return res.status(403).json({
          error:
            "You cannot delete this reply",
        });
      }

      const replyId =
        String(reply._id);

      review.replies =
        review.replies.filter(
          (item) =>
            String(item._id) !==
              replyId &&
            String(
              item.parentComment ||
              ""
            ) !== replyId
        );

      await review.save();

      return res.status(200).json({
        message:
          "Reply deleted",

        replyId,

        replyCount:
          review.replies.length,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to delete reply"
      );
    }
  }
);

// ======================================================
// POST /api/show-reviews/:reviewId/replies/:replyId/like
//
// Toggle reply like.
// Sends a notification only when adding a like.
// ======================================================

router.post(
    "/:reviewId/replies/:replyId/like",
    protect,
    async (req, res) => {
      try {
        const userId =
          getAuthenticatedUserId(req);
  
        if (
          !mongoose.isValidObjectId(
            req.params.reviewId
          ) ||
          !mongoose.isValidObjectId(
            req.params.replyId
          )
        ) {
          return res.status(400).json({
            error:
              "Invalid review or reply ID",
          });
        }
  
        const review =
          await ShowReview.findById(
            req.params.reviewId
          );
  
        if (!review) {
          return res.status(404).json({
            error:
              "Show review not found",
          });
        }
  
        const reply =
          review.replies.id(
            req.params.replyId
          );
  
        if (!reply) {
          return res.status(404).json({
            error:
              "Reply not found",
          });
        }
  
        const alreadyLiked =
          includesObjectId(
            reply.likes,
            userId
          );
  
        if (alreadyLiked) {
          reply.likes =
            removeObjectId(
              reply.likes,
              userId
            );
        } else {
          reply.likes.push(
            userId
          );
        }
  
        await review.save();
  
        if (!alreadyLiked) {
          await sendNotification({
            type:
              "reaction",
  
            fromUserId:
              userId,
  
            toUserId:
              reply.user,
  
            mediaType:
              "tv",
  
            targetType:
              "showReview",
  
            showId:
              String(
                review.showTmdbId
              ),
  
            showTitle:
              review.showName || "",
  
            showPoster:
              review.showPoster || "",
  
            showBackdrop:
              review.showBackdrop || "",
  
            showReviewId:
              review._id,
  
            relatedId:
              String(
                reply._id
              ),
  
            deduplicationKey:
              `show-review-reply-like:${review._id}:${reply._id}:${userId}`,
  
            metadata: {
              action:
                "reply_like",
  
              replyId:
                String(
                  reply._id
                ),
  
              reviewId:
                String(
                  review._id
                ),
            },
          });
        }
  
        return res.status(200).json({
          liked:
            !alreadyLiked,
  
          likeCount:
            reply.likes.length,
        });
      } catch (error) {
        return handleError(
          error,
          res,
          "Failed to like reply"
        );
      }
    }
  );

// ======================================================
// Export
// ======================================================

module.exports = router;

