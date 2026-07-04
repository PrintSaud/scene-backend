// src/models/customPoster.js

const mongoose = require("mongoose");

const customPosterSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // TMDB movie ID.
    // Keep the existing name so current movie routes do not break.
    movieId: {
      type: Number,
      required: true,
    },

    posterUrl: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// One selected poster per user per movie.
customPosterSchema.index(
  {
    userId: 1,
    movieId: 1,
  },
  {
    unique: true,
  }
);

// Useful when loading all custom movie posters for one user.
customPosterSchema.index({
  userId: 1,
  updatedAt: -1,
});

customPosterSchema.pre("validate", function (next) {
  try {
    if (typeof this.posterUrl === "string") {
      this.posterUrl = this.posterUrl.trim();
    }

    next();
  } catch (error) {
    next(error);
  }
});

module.exports =
  mongoose.models.CustomPoster ||
  mongoose.model("CustomPoster", customPosterSchema);