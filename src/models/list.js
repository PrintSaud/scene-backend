// src/models/list.js

const mongoose = require("mongoose");

// =========================
// Movie item
// =========================

const movieItemSchema = new mongoose.Schema({
  // Keep "id" as a string for compatibility with current movie routes.
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

  poster: {
    type: String,
    default: "",
  },

  releaseDate: {
    type: String,
    default: "",
  },

  addedAt: {
    type: Date,
    default: Date.now,
  },
});

// =========================
// TV show item
// =========================

const showItemSchema = new mongoose.Schema({
  // TMDB show ID stored as a string to match the movie-list structure.
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

  poster: {
    type: String,
    default: "",
  },

  firstAirDate: {
    type: String,
    default: "",
  },

  addedAt: {
    type: Date,
    default: Date.now,
  },
});

// =========================
// List
// =========================

const ListSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
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
    },

    // Every list belongs to one Scene world.
    // Existing lists remain movie lists by default.
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

    isRanked: {
      type: Boolean,
      default: false,
    },

    // Movie lists use this array.
    movies: {
      type: [movieItemSchema],
      default: [],
    },

    // Scene TV lists use this array.
    shows: {
      type: [showItemSchema],
      default: [],
    },

    likes: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },

    savedBy: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },

    // Allows imported TV lists to be identified safely later.
    source: {
      type: String,
      enum: ["manual", "tv_time_import", "scene_import"],
      default: "manual",
    },

    importJob: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TVImportJob",
      default: null,
    },

    externalImportId: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// =========================
// Indexes
// =========================

// Load a user's movie or TV lists in newest-first order.
ListSchema.index({
  user: 1,
  mediaType: 1,
  createdAt: -1,
});

// Public list discovery.
ListSchema.index({
  mediaType: 1,
  isPrivate: 1,
  createdAt: -1,
});

// Lists a user has saved.
ListSchema.index({
  savedBy: 1,
  mediaType: 1,
  createdAt: -1,
});

// Lists a user has liked.
ListSchema.index({
  likes: 1,
  mediaType: 1,
  createdAt: -1,
});

// Prevent duplicate imported lists when an external ID is available.
ListSchema.index(
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

// =========================
// Virtual values
// =========================

ListSchema.virtual("itemCount").get(function () {
  if (this.mediaType === "tv") {
    return Array.isArray(this.shows)
      ? this.shows.length
      : 0;
  }

  return Array.isArray(this.movies)
    ? this.movies.length
    : 0;
});

// Include virtual values when converting to JSON.
ListSchema.set("toJSON", {
  virtuals: true,
});

ListSchema.set("toObject", {
  virtuals: true,
});

// =========================
// Validation and cleanup
// =========================

ListSchema.pre("validate", function (next) {
  try {
    if (typeof this.title === "string") {
      this.title = this.title.trim();
    }

    if (typeof this.description === "string") {
      this.description = this.description.trim();
    }

    // Existing lists created before Scene TV are movie lists.
    if (!this.mediaType) {
      this.mediaType = "movies";
    }

    // Remove invalid and duplicate movies while preserving list order.
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

        const normalizedId = String(movie.id).trim();

        if (!normalizedId || seenMovieIds.has(normalizedId)) {
          return false;
        }

        movie.id = normalizedId;

        if (typeof movie.title === "string") {
          movie.title = movie.title.trim();
        }

        seenMovieIds.add(normalizedId);
        return true;
      });
    }

    // Remove invalid and duplicate shows while preserving list order.
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

        const normalizedId = String(show.id).trim();

        if (!normalizedId || seenShowIds.has(normalizedId)) {
          return false;
        }

        show.id = normalizedId;

        if (typeof show.name === "string") {
          show.name = show.name.trim();
        }

        seenShowIds.add(normalizedId);
        return true;
      });
    }

    // Protect Scene's two-world separation.
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

    // Remove duplicate saves.
    if (Array.isArray(this.savedBy)) {
      const seenSaves = new Set();

      this.savedBy = this.savedBy.filter((userId) => {
        if (!userId) {
          return false;
        }

        const value = String(userId);

        if (seenSaves.has(value)) {
          return false;
        }

        seenSaves.add(value);
        return true;
      });
    }

    next();
  } catch (error) {
    next(error);
  }
});

module.exports =
  mongoose.models.List ||
  mongoose.model("List", ListSchema);

  