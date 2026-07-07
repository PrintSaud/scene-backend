// src/models/customEpisodeBackdrop.js

const mongoose = require("mongoose");

const { Schema } = mongoose;

const customEpisodeBackdropSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Optional Scene references.
    show: {
      type: Schema.Types.ObjectId,
      ref: "Show",
      default: null,
      index: true,
    },

    episode: {
      type: Schema.Types.ObjectId,
      ref: "Episode",
      default: null,
      index: true,
    },

    /**
     * TMDB show ID.
     *
     * The existing field name is preserved for compatibility.
     */
    showId: {
      type: Number,
      required: true,
      min: 1,
      index: true,
    },

    /**
     * TMDB episode ID.
     *
     * It may be unavailable in older data, so the show/season/episode
     * position remains the guaranteed fallback identity.
     */
    episodeId: {
      type: Number,
      default: null,
      min: 1,
      index: true,
    },

    seasonNumber: {
      type: Number,
      required: true,
      min: 0,
    },

    episodeNumber: {
      type: Number,
      required: true,
      min: 1,
    },

    /**
     * The user's currently selected default backdrop for this episode.
     *
     * When a new TVLog is created, the route may copy this value into
     * TVLog.customEpisodeBackdrop.
     *
     * Existing logs retain their own backdrop snapshots even if this
     * selection later changes.
     */
    backdropUrl: {
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

// Exactly one current default backdrop per user and episode position.
customEpisodeBackdropSchema.index(
  {
    userId: 1,
    showId: 1,
    seasonNumber: 1,
    episodeNumber: 1,
  },
  {
    unique: true,
    name: "unique_user_episode_backdrop",
  }
);


// Resolve a user's selected backdrop using the TMDB episode ID.
customEpisodeBackdropSchema.index(
  {
    userId: 1,
    episodeId: 1,
  },
  {
    name: "user_episode_tmdb_backdrop",
    partialFilterExpression: {
      episodeId: {
        $type: "number",
      },
    },
  }
);

// Administrative or cleanup queries for a show.
customEpisodeBackdropSchema.index(
  {
    showId: 1,
    updatedAt: -1,
  },
  {
    name: "show_episode_backdrops",
  }
);

// ======================================================
// Validation and normalization
// ======================================================

customEpisodeBackdropSchema.pre(
  "validate",
  function normalizeCustomEpisodeBackdrop(next) {
    try {
      if (typeof this.backdropUrl === "string") {
        this.backdropUrl = this.backdropUrl.trim();
      }

      if (!this.backdropUrl) {
        return next(
          new Error("A custom episode backdrop is required.")
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

      if (
        !Number.isInteger(this.seasonNumber) ||
        this.seasonNumber < 0
      ) {
        return next(
          new Error("A valid season number is required.")
        );
      }

      if (
        !Number.isInteger(this.episodeNumber) ||
        this.episodeNumber < 1
      ) {
        return next(
          new Error("A valid episode number is required.")
        );
      }

      if (
        this.episodeId !== null &&
        (!Number.isInteger(this.episodeId) ||
          this.episodeId < 1)
      ) {
        this.episodeId = null;
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

customEpisodeBackdropSchema.virtual("showTmdbId").get(
  function getShowTmdbId() {
    return this.showId;
  }
);

customEpisodeBackdropSchema.virtual("episodeTmdbId").get(
  function getEpisodeTmdbId() {
    return this.episodeId;
  }
);

customEpisodeBackdropSchema.virtual("episodeCode").get(
  function getEpisodeCode() {
    return `S${this.seasonNumber} E${this.episodeNumber}`;
  }
);

customEpisodeBackdropSchema.set("toJSON", {
  virtuals: true,
});

customEpisodeBackdropSchema.set("toObject", {
  virtuals: true,
});

// ======================================================
// Export
// ======================================================

module.exports =
  mongoose.models.CustomEpisodeBackdrop ||
  mongoose.model(
    "CustomEpisodeBackdrop",
    customEpisodeBackdropSchema
  );