// src/models/showReview.js

const mongoose = require("mongoose");

const { Schema } = mongoose;

// ======================================================
// Reply/comment schema
// ======================================================

const replySchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    text: {
      type: String,
      default: "",
      trim: true,
      maxlength: 5000,
    },

    gif: {
      type: String,
      default: "",
      trim: true,
    },

    image: {
      type: String,
      default: "",
      trim: true,
    },

    likes: {
      type: [Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },

    // null means this is a top-level comment.
    // Otherwise, it references another embedded reply.
    parentComment: {
      type: Schema.Types.ObjectId,
      default: null,
    },
  },
  {
    _id: true,
    timestamps: true,
  }
);

// ======================================================
// Favorite show-character snapshot
// ======================================================

const favoriteCharacterSchema = new Schema(
  {
    // TMDB person/actor ID.
    actorId: {
      type: Number,
      default: null,
    },

    // TMDB cast credit ID when available.
    creditId: {
      type: String,
      default: "",
      trim: true,
    },

    characterName: {
      type: String,
      default: "",
      trim: true,
    },

    actorName: {
      type: String,
      default: "",
      trim: true,
    },

    profilePath: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    _id: false,
  }
);

// ======================================================
// Show review schema
// ======================================================

const showReviewSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Optional Scene Show document reference.
    show: {
      type: Schema.Types.ObjectId,
      ref: "Show",
      default: null,
      index: true,
    },

    // ==================================================
    // Show identity snapshot
    // ==================================================

    showTmdbId: {
      type: Number,
      required: true,
      min: 1,
      index: true,
    },

    showName: {
      type: String,
      required: true,
      trim: true,
    },

    showNameAr: {
      type: String,
      default: "",
      trim: true,
    },

    showPoster: {
      type: String,
      default: "",
      trim: true,
    },

    showBackdrop: {
      type: String,
      default: "",
      trim: true,
    },

    firstAirDate: {
      type: String,
      default: "",
      trim: true,
    },

    // ==================================================
    // Rating and review
    // ==================================================

    rating: {
      type: Number,
      min: 0.5,
      max: 5,
      default: null,

      validate: {
        validator(value) {
          if (value === null || value === undefined) {
            return true;
          }

          return Number.isInteger(value * 2);
        },

        message:
          "Rating must use half-star increments between 0.5 and 5.",
      },
    },

    review: {
      type: String,
      default: "",
      trim: true,
      maxlength: 20000,
    },

    containsSpoilers: {
      type: Boolean,
      default: false,
    },

    /**
     * Backdrop selected specifically for this show review.
     *
     * It is independent from:
     * - The default TMDB show backdrop
     * - The user's TV profile backdrop
     * - Episode review backdrops
     */
    customBackdrop: {
      type: String,
      default: "",
      trim: true,
    },

    // ==================================================
    // Review media
    // ==================================================

    gif: {
      type: String,
      default: "",
      trim: true,
    },

    // Preserves compatibility with the current Movie review system.
    image: {
      type: String,
      default: "",
      trim: true,
    },

    images: {
      type: [String],
      default: [],
    },

    // ==================================================
    // Favorite show character snapshot
    // ==================================================

    /**
     * Snapshot of the user's selected show-level favorite character.
     *
     * The current selection lives in ShowFavoriteCharacter.
     * This snapshot preserves what appeared on the review when saved.
     */
    favoriteCharacter: {
      type: favoriteCharacterSchema,
      default: null,
    },

    // ==================================================
    // Social interaction
    // ==================================================

    likes: {
      type: [Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },

    replies: {
      type: [replySchema],
      default: [],
    },

    // ==================================================
    // Source information
    // ==================================================

    source: {
      type: String,
      enum: ["manual", "tv_time_import", "scene_import"],
      default: "manual",
      index: true,
    },

    importJob: {
      type: Schema.Types.ObjectId,
      ref: "TVImportJob",
      default: null,
      index: true,
    },

    externalImportId: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

// ======================================================
// Indexes
// ======================================================

// One overall show review per user per show.
showReviewSchema.index(
  {
    user: 1,
    showTmdbId: 1,
  },
  {
    unique: true,
    name: "unique_user_show_review",
  }
);

// All reviews for one show, newest first.
showReviewSchema.index({
  showTmdbId: 1,
  createdAt: -1,
});

// User's TV profile review history.
showReviewSchema.index({
  user: 1,
  createdAt: -1,
});

// Profile filtering and Most Liked ordering.
showReviewSchema.index({
  user: 1,
  updatedAt: -1,
});

// Show-page review retrieval.
showReviewSchema.index({
  showTmdbId: 1,
  updatedAt: -1,
});

// Favorite-character aggregation from show reviews if needed.
showReviewSchema.index({
  showTmdbId: 1,
  "favoriteCharacter.actorId": 1,
});

// Prevent duplicate imported show reviews.
showReviewSchema.index(
  {
    user: 1,
    source: 1,
    externalImportId: 1,
  },
  {
    unique: true,
    name: "unique_imported_show_review",
    partialFilterExpression: {
      externalImportId: {
        $type: "string",
      },
    },
  }
);

// ======================================================
// Validation and normalization
// ======================================================

showReviewSchema.pre(
  "validate",
  function normalizeShowReview(next) {
    try {
      const trimFields = [
        "showName",
        "showNameAr",
        "showPoster",
        "showBackdrop",
        "firstAirDate",
        "review",
        "customBackdrop",
        "gif",
        "image",
        "externalImportId",
      ];

      for (const field of trimFields) {
        if (typeof this[field] === "string") {
          this[field] = this[field].trim();
        }
      }

      if (
        !Number.isInteger(this.showTmdbId) ||
        this.showTmdbId < 1
      ) {
        this.invalidate(
          "showTmdbId",
          "A valid TMDB show ID is required."
        );
      }

      if (!this.showName) {
        this.invalidate(
          "showName",
          "A show name is required."
        );
      }

      if (
        this.rating === undefined ||
        this.rating === ""
      ) {
        this.rating = null;
      }

      if (!this.externalImportId) {
        this.externalImportId = null;
      }

      // A ShowReview must contain at least a rating,
      // written review, GIF, or image.
      const hasReviewContent = Boolean(
        this.rating !== null ||
          this.review ||
          this.gif ||
          this.image ||
          (
            Array.isArray(this.images) &&
            this.images.length > 0
          )
      );

      if (!hasReviewContent) {
        this.invalidate(
          "review",
          "A show review requires a rating, review, GIF, or image."
        );
      }

      // Normalize and deduplicate attached images.
      if (Array.isArray(this.images)) {
        this.images = [
          ...new Set(
            this.images
              .filter(
                (value) => typeof value === "string"
              )
              .map((value) => value.trim())
              .filter(Boolean)
          ),
        ];
      }

      // Preserve older clients that send one image.
      if (
        this.image &&
        !this.images.includes(this.image)
      ) {
        this.images.unshift(this.image);
      }

      // Preserve clients expecting one image field.
      if (
        !this.image &&
        this.images.length > 0
      ) {
        this.image = this.images[0];
      }

      // Remove duplicate likes.
      if (Array.isArray(this.likes)) {
        const seenLikes = new Set();

        this.likes = this.likes.filter((userId) => {
          if (!userId) {
            return false;
          }

          const value = String(userId);

          if (seenLikes.has(value)) {
            return false;
          }

          seenLikes.add(value);
          return true;
        });
      }

      if (this.favoriteCharacter) {
        const character = this.favoriteCharacter;

        if (
          typeof character.creditId === "string"
        ) {
          character.creditId =
            character.creditId.trim();
        }

        if (
          typeof character.characterName ===
          "string"
        ) {
          character.characterName =
            character.characterName.trim();
        }

        if (
          typeof character.actorName === "string"
        ) {
          character.actorName =
            character.actorName.trim();
        }

        if (
          typeof character.profilePath === "string"
        ) {
          character.profilePath =
            character.profilePath.trim();
        }

        const hasCharacterData = Boolean(
          character.actorId ||
            character.creditId ||
            character.characterName ||
            character.actorName ||
            character.profilePath
        );

        if (!hasCharacterData) {
          this.favoriteCharacter = null;
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  }
);

// ======================================================
// Helpful virtuals
// ======================================================

showReviewSchema.virtual("hasWrittenReview").get(
  function getHasWrittenReview() {
    return Boolean(
      this.review ||
        this.gif ||
        this.image ||
        (
          Array.isArray(this.images) &&
          this.images.length > 0
        )
    );
  }
);

showReviewSchema.virtual("displayBackdrop").get(
  function getDisplayBackdrop() {
    return (
      this.customBackdrop ||
      this.showBackdrop ||
      ""
    );
  }
);

showReviewSchema.virtual("likeCount").get(
  function getLikeCount() {
    return Array.isArray(this.likes)
      ? this.likes.length
      : 0;
  }
);

showReviewSchema.virtual("replyCount").get(
  function getReplyCount() {
    return Array.isArray(this.replies)
      ? this.replies.length
      : 0;
  }
);

showReviewSchema.virtual("teamTag").get(
  function getTeamTag() {
    const characterName =
      this.favoriteCharacter?.characterName || "";

    if (!characterName) {
      return "";
    }

    return `#Team${characterName.replace(
      /\s+/g,
      ""
    )}`;
  }
);

showReviewSchema.set("toJSON", {
  virtuals: true,
});

showReviewSchema.set("toObject", {
  virtuals: true,
});

// ======================================================
// Export
// ======================================================

module.exports =
  mongoose.models.ShowReview ||
  mongoose.model(
    "ShowReview",
    showReviewSchema
  );

  