// src/models/tvLog.js

const mongoose = require("mongoose");

const { Schema } = mongoose;

// ======================================================
// Embedded reply/comment schema
// ======================================================

const replySchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
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

    // References another embedded reply inside the same TVLog.
    // null means this is a top-level comment.
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
// Favorite episode character snapshot
// ======================================================

const favoriteCharacterSchema = new Schema(
  {
    // TMDB cast-credit ID when available.
    characterId: {
      type: Number,
      default: null,
    },

    // TMDB person/actor ID.
    actorId: {
      type: Number,
      default: null,
      index: true,
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
// TV episode log schema
// ======================================================

const tvLogSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Optional Scene Show document reference.
    // TMDB IDs remain the portable source of identity.
    show: {
      type: Schema.Types.ObjectId,
      ref: "Show",
      default: null,
      index: true,
    },

    // ==================================================
    // Show snapshot
    // ==================================================

    showTmdbId: {
      type: Number,
      required: true,
      index: true,
    },

    showName: {
      type: String,
      required: true,
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
    // Episode snapshot
    // ==================================================

    seasonNumber: {
      type: Number,
      required: true,
      min: 0,
      index: true,
    },

    episodeNumber: {
      type: Number,
      required: true,
      min: 1,
      index: true,
    },

    episodeTmdbId: {
      type: Number,
      default: null,
      index: true,
    },

    episodeName: {
      type: String,
      default: "",
      trim: true,
    },

    episodeOverview: {
      type: String,
      default: "",
      trim: true,
    },

    episodeAirDate: {
      type: String,
      default: "",
      trim: true,
    },

    episodeRuntime: {
      type: Number,
      default: null,
      min: 0,
    },

    episodeStillPath: {
      type: String,
      default: "",
      trim: true,
    },

    // Selected backdrop for this exact log/review.
    // Different rewatches may use different backdrops.
    customEpisodeBackdrop: {
      type: String,
      default: "",
      trim: true,
    },

    // Snapshot of the user's selected show poster at log time.
    customShowPoster: {
      type: String,
      default: "",
      trim: true,
    },

    // ==================================================
    // Rating and review
    // ==================================================

    review: {
      type: String,
      default: "",
      trim: true,
      maxlength: 20000,
    },

    rating: {
      type: Number,
      min: 0.5,
      max: 5,
      default: null,

      // Scene uses half-star increments.
      validate: {
        validator(value) {
          if (value === null || value === undefined) {
            return true;
          }

          return Number.isInteger(value * 2);
        },
        message: "Rating must use half-star increments between 0.5 and 5.",
      },
    },

    containsSpoilers: {
      type: Boolean,
      default: false,
    },

    // ==================================================
    // Watch history and rewatches
    // ==================================================

    watchedAt: {
      type: Date,
      default: Date.now,
      required: true,
      index: true,
    },

    /**
     * The chronological watch number for this user's episode history.
     *
     * First watch  -> watchNumber: 1
     * First rewatch -> watchNumber: 2
     * Second rewatch -> watchNumber: 3
     *
     * Each watch remains its own TVLog document.
     */
    watchNumber: {
      type: Number,
      default: 1,
      min: 1,
    },

    // Kept as a convenient stored field for feed and response queries.
    // Middleware keeps this synchronized with watchNumber.
    rewatch: {
      type: Boolean,
      default: false,
      index: true,
    },

    /**
     * Describes how the user created the log inside Scene.
     *
     * full:
     *   Created through the complete episode logging screen.
     *
     * quick:
     *   Created through the Upcoming Episodes eye button.
     *
     * bulk_season:
     *   Created by marking the remaining aired episodes of a season watched.
     *
     * import:
     *   Created through an external import.
     */
    logMethod: {
      type: String,
      enum: ["full", "quick", "bulk_season", "import"],
      default: "full",
      index: true,
    },

    // Identifies the broader data source.
    source: {
      type: String,
      enum: ["manual", "tv_time_import", "scene_import", "system"],
      default: "manual",
      index: true,
    },

    importJob: {
      type: Schema.Types.ObjectId,
      ref: "TVImportJob",
      default: null,
      index: true,
    },

    // Stable identifier supplied by an external importer.
    externalImportId: {
      type: String,
      default: null,
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

    // Kept for compatibility with the existing movie-log structure.
    image: {
      type: String,
      default: "",
      trim: true,
    },

    // Supports multiple photos without breaking existing single-image data.
    images: {
      type: [String],
      default: [],
    },

    // ==================================================
    // Favorite episode character
    // ==================================================

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
  },
  {
    timestamps: true,
    minimize: false,
  }
);

// ======================================================
// Indexes
// ======================================================

// User TV diary and profile activity.
tvLogSchema.index({
  user: 1,
  watchedAt: -1,
  createdAt: -1,
});

// All logs by one user for one show.
tvLogSchema.index({
  user: 1,
  showTmdbId: 1,
  watchedAt: -1,
});

// All watches and rewatches of one exact episode.
tvLogSchema.index({
  user: 1,
  showTmdbId: 1,
  seasonNumber: 1,
  episodeNumber: 1,
  watchedAt: -1,
});

// Resolve the latest log for one user and episode.
// This powers the one-card-per-user-per-episode feed behavior.
tvLogSchema.index({
  user: 1,
  showTmdbId: 1,
  seasonNumber: 1,
  episodeNumber: 1,
  createdAt: -1,
});

// Episode reviews, ratings, and community activity.
tvLogSchema.index({
  showTmdbId: 1,
  seasonNumber: 1,
  episodeNumber: 1,
  createdAt: -1,
});

// Popular episode reviews.
tvLogSchema.index({
  showTmdbId: 1,
  seasonNumber: 1,
  episodeNumber: 1,
  "likes.0": 1,
  createdAt: -1,
});

// Show progress and season progress queries.
tvLogSchema.index({
  user: 1,
  showTmdbId: 1,
  seasonNumber: 1,
  episodeNumber: 1,
});


// Episode favorite-character aggregation.
tvLogSchema.index({
  showTmdbId: 1,
  seasonNumber: 1,
  episodeNumber: 1,
  "favoriteCharacter.actorId": 1,
});

// Retrieve all reviewed episode logs by a user.
tvLogSchema.index({
  user: 1,
  review: 1,
  createdAt: -1,
});

// Imported rows may never be inserted twice.
tvLogSchema.index(
  {
    user: 1,
    source: 1,
    externalImportId: 1,
  },
  {
    unique: true,
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

tvLogSchema.pre("validate", function normalizeTVLog(next) {
  try {
    const trimFields = [
      "showName",
      "showPoster",
      "showBackdrop",
      "firstAirDate",
      "episodeName",
      "episodeOverview",
      "episodeAirDate",
      "episodeStillPath",
      "customEpisodeBackdrop",
      "customShowPoster",
      "review",
      "gif",
      "image",
      "externalImportId",
    ];

    for (const field of trimFields) {
      if (typeof this[field] === "string") {
        this[field] = this[field].trim();
      }
    }

    if (this.rating === undefined || this.rating === "") {
      this.rating = null;
    }

    if (
      this.externalImportId === undefined ||
      this.externalImportId === ""
    ) {
      this.externalImportId = null;
    }

    if (!Number.isInteger(this.watchNumber) || this.watchNumber < 1) {
      this.watchNumber = 1;
    }

    // watchNumber is the source of truth.
    this.rewatch = this.watchNumber > 1;

    // Imported records should be explicitly identified as import logs.
    if (
      this.source === "tv_time_import" ||
      this.source === "scene_import"
    ) {
      this.logMethod = "import";
    }

    if (Array.isArray(this.images)) {
      this.images = [
        ...new Set(
          this.images
            .filter((value) => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean)
        ),
      ];
    }

    // Preserve old clients that send only `image`.
    if (this.image && !this.images.includes(this.image)) {
      this.images.unshift(this.image);
    }

    // Preserve clients expecting the original single-image field.
    if (!this.image && this.images.length > 0) {
      this.image = this.images[0];
    }

    if (this.favoriteCharacter) {
      const character = this.favoriteCharacter;

      if (typeof character.characterName === "string") {
        character.characterName = character.characterName.trim();
      }

      if (typeof character.actorName === "string") {
        character.actorName = character.actorName.trim();
      }

      if (typeof character.profilePath === "string") {
        character.profilePath = character.profilePath.trim();
      }

      const hasCharacterData =
        character.characterId !== null ||
        character.actorId !== null ||
        character.characterName ||
        character.actorName ||
        character.profilePath;

      if (!hasCharacterData) {
        this.favoriteCharacter = null;
      }
    }

    next();
  } catch (error) {
    next(error);
  }
});

// ======================================================
// Helpful virtuals
// ======================================================

tvLogSchema.virtual("hasReview").get(function getHasReview() {
  return Boolean(
    this.review ||
      this.gif ||
      this.image ||
      (Array.isArray(this.images) && this.images.length > 0)
  );
});

tvLogSchema.virtual("displayBackdrop").get(function getDisplayBackdrop() {
  return (
    this.customEpisodeBackdrop ||
    this.episodeStillPath ||
    this.showBackdrop ||
    ""
  );
});

tvLogSchema.set("toJSON", {
  virtuals: true,
});

tvLogSchema.set("toObject", {
  virtuals: true,
});

// ======================================================
// Export
// ======================================================

module.exports =
  mongoose.models.TVLog ||
  mongoose.model("TVLog", tvLogSchema);