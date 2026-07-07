// src/models/list.js

const mongoose = require("mongoose");

const { Schema } = mongoose;

// ======================================================
// Movie item
// ======================================================

const movieItemSchema = new Schema(
  {
    /**
     * TMDB movie ID.
     *
     * Kept as a string for compatibility with the existing
     * Scene movie-list routes.
     */
    id: {
      type: String,
      required: true,
      trim: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    titleAr: {
      type: String,
      default: "",
      trim: true,
    },

    originalTitle: {
      type: String,
      default: "",
      trim: true,
    },

    poster: {
      type: String,
      default: "",
      trim: true,
    },

    backdrop: {
      type: String,
      default: "",
      trim: true,
    },

    releaseDate: {
      type: String,
      default: "",
      trim: true,
    },

    addedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    // Preserve item _id values because existing Movie routes
    // may already use them when editing or removing list items.
    _id: true,
  }
);

// ======================================================
// TV show item
// ======================================================

const showItemSchema = new Schema(
  {
    /**
     * TMDB show ID.
     *
     * Stored as a string to match the existing Movie-list
     * structure and route behavior.
     */
    id: {
      type: String,
      required: true,
      trim: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    nameAr: {
      type: String,
      default: "",
      trim: true,
    },

    originalName: {
      type: String,
      default: "",
      trim: true,
    },

    poster: {
      type: String,
      default: "",
      trim: true,
    },

    backdrop: {
      type: String,
      default: "",
      trim: true,
    },

    firstAirDate: {
      type: String,
      default: "",
      trim: true,
    },

    addedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: true,
  }
);

// ======================================================
// Scene list
// ======================================================

const listSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },

    coverImage: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },

    /**
     * Scene keeps Movie and TV lists separate.
     *
     * Existing lists remain Movie lists by default.
     */
    mediaType: {
      type: String,
      enum: ["movies", "tv"],
      default: "movies",
      required: true,
      index: true,
    },

    isPrivate: {
      type: Boolean,
      default: false,
      index: true,
    },

    /**
     * Array order is the ranking order when true.
     *
     * No separate rank field is required because moving items
     * inside the array changes their displayed rank.
     */
    isRanked: {
      type: Boolean,
      default: false,
      index: true,
    },

    // Movie lists use only this array.
    movies: {
      type: [movieItemSchema],
      default: [],
    },

    // TV lists use only this array.
    shows: {
      type: [showItemSchema],
      default: [],
    },

    likes: {
      type: [Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },

    savedBy: {
      type: [Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },

    // ==================================================
    // Import information
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

// Load a user's Movie or TV lists.
listSchema.index({
  user: 1,
  mediaType: 1,
  updatedAt: -1,
});

// Public Movie/TV list discovery.
listSchema.index({
  mediaType: 1,
  isPrivate: 1,
  updatedAt: -1,
});

// Ranked-list discovery.
listSchema.index({
  mediaType: 1,
  isPrivate: 1,
  isRanked: 1,
  updatedAt: -1,
});

// Lists saved by a user.
listSchema.index({
  savedBy: 1,
  mediaType: 1,
  updatedAt: -1,
});

// Lists liked by a user.
listSchema.index({
  likes: 1,
  mediaType: 1,
  updatedAt: -1,
});

// Search a user's own lists by title.
listSchema.index({
  user: 1,
  mediaType: 1,
  title: 1,
});

// Prevent duplicate imported lists when an external ID exists.
listSchema.index(
  {
    user: 1,
    source: 1,
    externalImportId: 1,
  },
  {
    unique: true,
    name: "unique_imported_scene_list",
    partialFilterExpression: {
      externalImportId: {
        $type: "string",
      },
    },
  }
);

// ======================================================
// Virtual values
// ======================================================

listSchema.virtual("itemCount").get(function getItemCount() {
  if (this.mediaType === "tv") {
    return Array.isArray(this.shows)
      ? this.shows.length
      : 0;
  }

  return Array.isArray(this.movies)
    ? this.movies.length
    : 0;
});

listSchema.virtual("likeCount").get(function getLikeCount() {
  return Array.isArray(this.likes)
    ? this.likes.length
    : 0;
});

listSchema.virtual("saveCount").get(function getSaveCount() {
  return Array.isArray(this.savedBy)
    ? this.savedBy.length
    : 0;
});

listSchema.virtual("items").get(function getItems() {
  return this.mediaType === "tv"
    ? this.shows
    : this.movies;
});

listSchema.set("toJSON", {
  virtuals: true,
});

listSchema.set("toObject", {
  virtuals: true,
});

// ======================================================
// Validation and normalization
// ======================================================

listSchema.pre("validate", function normalizeList(next) {
  try {
    const trimString = (value) => {
      return typeof value === "string"
        ? value.trim()
        : "";
    };

    this.title = trimString(this.title);
    this.description = trimString(this.description);
    this.coverImage = trimString(this.coverImage);

    if (!this.title) {
      this.invalidate(
        "title",
        "A list title is required."
      );
    }

    // Lists created before Scene TV remain Movie lists.
    if (!this.mediaType) {
      this.mediaType = "movies";
    }

    // Empty import IDs must become null so the partial unique
    // index does not treat every empty value as the same import.
    if (
      this.externalImportId === undefined ||
      this.externalImportId === null ||
      trimString(this.externalImportId) === ""
    ) {
      this.externalImportId = null;
    } else {
      this.externalImportId =
        trimString(this.externalImportId);
    }

    // Imported lists should identify their import relationship.
    if (
      this.source === "tv_time_import" ||
      this.source === "scene_import"
    ) {
      if (!this.externalImportId && !this.importJob) {
        this.invalidate(
          "externalImportId",
          "Imported lists require an import job or external import ID."
        );
      }
    }

    // ==================================================
    // Normalize Movie items
    // ==================================================

    if (Array.isArray(this.movies)) {
      const seenMovieIds = new Set();

      this.movies = this.movies.filter((movie) => {
        if (
          !movie ||
          movie.id === undefined ||
          movie.id === null
        ) {
          return false;
        }

        const normalizedId =
          String(movie.id).trim();

        if (
          !normalizedId ||
          seenMovieIds.has(normalizedId)
        ) {
          return false;
        }

        movie.id = normalizedId;
        movie.title = trimString(movie.title);
        movie.titleAr = trimString(movie.titleAr);
        movie.originalTitle = trimString(
          movie.originalTitle
        );
        movie.poster = trimString(movie.poster);
        movie.backdrop = trimString(movie.backdrop);
        movie.releaseDate = trimString(
          movie.releaseDate
        );

        if (!movie.title) {
          return false;
        }

        seenMovieIds.add(normalizedId);
        return true;
      });
    }

    // ==================================================
    // Normalize TV-show items
    // ==================================================

    if (Array.isArray(this.shows)) {
      const seenShowIds = new Set();

      this.shows = this.shows.filter((show) => {
        if (
          !show ||
          show.id === undefined ||
          show.id === null
        ) {
          return false;
        }

        const normalizedId =
          String(show.id).trim();

        if (
          !normalizedId ||
          seenShowIds.has(normalizedId)
        ) {
          return false;
        }

        show.id = normalizedId;
        show.name = trimString(show.name);
        show.nameAr = trimString(show.nameAr);
        show.originalName = trimString(
          show.originalName
        );
        show.poster = trimString(show.poster);
        show.backdrop = trimString(show.backdrop);
        show.firstAirDate = trimString(
          show.firstAirDate
        );

        if (!show.name) {
          return false;
        }

        seenShowIds.add(normalizedId);
        return true;
      });
    }

    // ==================================================
    // Enforce Movie/TV separation
    // ==================================================

    if (
      this.mediaType === "movies" &&
      Array.isArray(this.shows) &&
      this.shows.length > 0
    ) {
      this.invalidate(
        "shows",
        "Movie lists cannot contain TV shows."
      );
    }

    if (
      this.mediaType === "tv" &&
      Array.isArray(this.movies) &&
      this.movies.length > 0
    ) {
      this.invalidate(
        "movies",
        "TV lists cannot contain movies."
      );
    }

    // ==================================================
    // Remove duplicate social references
    // ==================================================

    const deduplicateObjectIds = (values) => {
      if (!Array.isArray(values)) {
        return [];
      }

      const seen = new Set();

      return values.filter((value) => {
        if (!value) {
          return false;
        }

        const normalizedValue = String(value);

        if (seen.has(normalizedValue)) {
          return false;
        }

        seen.add(normalizedValue);
        return true;
      });
    };

    this.likes = deduplicateObjectIds(this.likes);
    this.savedBy = deduplicateObjectIds(
      this.savedBy
    );

    next();
  } catch (error) {
    next(error);
  }
});

// ======================================================
// Export
// ======================================================

module.exports =
  mongoose.models.List ||
  mongoose.model("List", listSchema);