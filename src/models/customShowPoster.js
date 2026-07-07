// src/models/customShowPoster.js

const mongoose = require("mongoose");

const { Schema } = mongoose;

const customShowPosterSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Optional reference to Scene's cached Show document.
    show: {
      type: Schema.Types.ObjectId,
      ref: "Show",
      default: null,
      index: true,
    },

    /**
     * TMDB show ID.
     *
     * The existing field name is preserved for compatibility.
     * In route responses, this may be exposed as showTmdbId.
     */
    showId: {
      type: Number,
      required: true,
      min: 1,
      index: true,
    },

    /**
     * The poster selected by this user for this show.
     *
     * This may be:
     * - A TMDB poster path
     * - A complete remote image URL
     * - A Scene-hosted image URL
     */
    posterUrl: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
  },
  {
    timestamps: true,
  }
);

// ======================================================
// Indexes
// ======================================================

// Exactly one selected poster per user and show.
customShowPosterSchema.index(
  {
    userId: 1,
    showId: 1,
  },
  {
    unique: true,
    name: "unique_user_custom_show_poster",
  }
);

// Load every custom show poster selected by one user.
customShowPosterSchema.index(
  {
    userId: 1,
    updatedAt: -1,
  },
  {
    name: "user_custom_show_posters",
  }
);

// Useful when a show is deleted, refreshed, or administratively audited.
customShowPosterSchema.index(
  {
    showId: 1,
    updatedAt: -1,
  },
  {
    name: "show_custom_posters",
  }
);

// ======================================================
// Validation and normalization
// ======================================================

customShowPosterSchema.pre(
  "validate",
  function normalizeCustomShowPoster(next) {
    try {
      if (typeof this.posterUrl === "string") {
        this.posterUrl = this.posterUrl.trim();
      }

      if (!this.posterUrl) {
        return next(
          new Error("A custom show poster is required.")
        );
      }

      if (
        !Number.isInteger(this.showId) ||
        this.showId < 1
      ) {
        return next(
          new Error("A valid TMDB show ID is required.")
        );
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

// Consistent alias used throughout the TV backend.
customShowPosterSchema.virtual("showTmdbId").get(
  function getShowTmdbId() {
    return this.showId;
  }
);

customShowPosterSchema.set("toJSON", {
  virtuals: true,
});

customShowPosterSchema.set("toObject", {
  virtuals: true,
});

// ======================================================
// Export
// ======================================================

module.exports =
  mongoose.models.CustomShowPoster ||
  mongoose.model(
    "CustomShowPoster",
    customShowPosterSchema
  );

  