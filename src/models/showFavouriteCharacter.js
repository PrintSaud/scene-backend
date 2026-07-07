// src/models/showFavoriteCharacter.js

const mongoose = require("mongoose");

const { Schema } = mongoose;

// ==============================================
// Favorite show character snapshot
// ==============================================

const characterSchema = new Schema(
  {
    // TMDB person ID for the actor.
    actorId: {
      type: Number,
      required: true,
      min: 1,
    },

    // TMDB credit ID when available.
    creditId: {
      type: String,
      default: "",
      trim: true,
    },

    characterName: {
      type: String,
      required: true,
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

// ==============================================
// Show favorite character
// ==============================================

const showFavoriteCharacterSchema = new Schema(
  {
    user: {
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

    // ==========================================
    // Show identity snapshot
    // ==========================================

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

    // ==========================================
    // Selected character
    // ==========================================

    character: {
      type: characterSchema,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// ==============================================
// Indexes
// ==============================================

// One favorite character selection per user per show.
//
// Changing the favorite character updates this existing document
// instead of creating a second vote.
showFavoriteCharacterSchema.index(
  {
    user: 1,
    showTmdbId: 1,
  },
  {
    unique: true,
    name: "unique_user_show_favorite_character",
  }
);

// Community character popularity for a show.
showFavoriteCharacterSchema.index({
  showTmdbId: 1,
  "character.actorId": 1,
});

// Load all show favorite-character selections made by one user.
showFavoriteCharacterSchema.index({
  user: 1,
  updatedAt: -1,
});

// ==============================================
// Validation and cleanup
// ==============================================

showFavoriteCharacterSchema.pre(
  "validate",
  function normalizeShowFavoriteCharacter(next) {
    try {
      const trimFields = [
        "showName",
        "showPoster",
        "showBackdrop",
        "firstAirDate",
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

      if (!this.character) {
        this.invalidate(
          "character",
          "A favorite character is required."
        );

        return next();
      }

      if (
        !Number.isInteger(this.character.actorId) ||
        this.character.actorId < 1
      ) {
        this.invalidate(
          "character.actorId",
          "A valid TMDB actor ID is required."
        );
      }

      if (
        typeof this.character.characterName === "string"
      ) {
        this.character.characterName =
          this.character.characterName.trim();
      }

      if (
        typeof this.character.actorName === "string"
      ) {
        this.character.actorName =
          this.character.actorName.trim();
      }

      if (
        typeof this.character.profilePath === "string"
      ) {
        this.character.profilePath =
          this.character.profilePath.trim();
      }

      if (
        typeof this.character.creditId === "string"
      ) {
        this.character.creditId =
          this.character.creditId.trim();
      }

      if (!this.character.characterName) {
        this.invalidate(
          "character.characterName",
          "A character name is required."
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  }
);

// ==============================================
// Helpful virtuals
// ==============================================

showFavoriteCharacterSchema.virtual("teamTag").get(
  function getTeamTag() {
    const name = this.character?.characterName || "";

    if (!name) {
      return "";
    }

    return `#Team${name.replace(/\s+/g, "")}`;
  }
);

showFavoriteCharacterSchema.set("toJSON", {
  virtuals: true,
});

showFavoriteCharacterSchema.set("toObject", {
  virtuals: true,
});

// ==============================================
// Export
// ==============================================

module.exports =
  mongoose.models.ShowFavoriteCharacter ||
  mongoose.model(
    "ShowFavoriteCharacter",
    showFavoriteCharacterSchema
  );

  