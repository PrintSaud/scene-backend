// src/models/HomeBanner.js

const mongoose = require("mongoose");

const { Schema } = mongoose;

const homeBannerSchema = new Schema(
  {
    // ==================================================
    // Banner content
    // ==================================================

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    subtitle: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },

    image: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },

    buttonText: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },

    // ==================================================
    // Movie / TV targeting
    // ==================================================

    /**
     * Controls where the banner appears.
     *
     * movies:
     *   Movie Home only.
     *
     * tv:
     *   TV Home only.
     *
     * both:
     *   Appears in both modes.
     *
     * Existing banners default to both so they do not disappear
     * when Scene TV launches.
     */
    mediaType: {
      type: String,
      enum: ["both"],
      default: "both",
    },

    // ==================================================
    // Visual design
    // ==================================================

    /**
     * Visual presentation only.
     *
     * Navigation behavior is controlled separately through actionType.
     */
    designType: {
      type: String,
      enum: ["text", "image", "link", "movie", "show"],
      default: "text",
      trim: true,
    },

    // ==================================================
    // Navigation
    // ==================================================

    /**
     * Exact destination opened when the banner is pressed.
     *
     * Existing Movie targets remain supported.
     */
    actionType: {
      type: String,
      enum: [
        "none",
        "screen",
        "movie",
        "show",
        "episode",
        "actor",
        "director",
        "cinematographer",
        "list",
        "url",
      ],
      default: "none",
      trim: true,
      index: true,
    },

    /**
     * Primary action value.
     *
     * Examples:
     *
     * movie:
     *   "550"
     *
     * show:
     *   "1396"
     *
     * screen:
     *   "Trending"
     *
     * list:
     *   MongoDB List ID
     *
     * url:
     *   "https://scenesa.com/..."
     */
    actionValue: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },

    /**
     * Additional structured navigation information.
     *
     * Mainly needed for Episode banners.
     *
     * Example:
     * {
     *   showTmdbId: 1396,
     *   episodeTmdbId: 62085,
     *   seasonNumber: 3,
     *   episodeNumber: 9
     * }
     */
    actionMetadata: {
      showTmdbId: {
        type: Number,
        default: null,
        min: 1,
      },

      episodeTmdbId: {
        type: Number,
        default: null,
        min: 1,
      },

      seasonNumber: {
        type: Number,
        default: null,
        min: 0,
      },

      episodeNumber: {
        type: Number,
        default: null,
        min: 1,
      },

      listMediaType: {
        type: String,
        enum: ["movies", "tv", null],
        default: null,
      },
    },

    // ==================================================
    // Colors
    // ==================================================

    backgroundColor: {
      type: String,
      default: "#1a1026",
      trim: true,
    },

    textColor: {
      type: String,
      default: "#ffffff",
      trim: true,
    },

    buttonColor: {
      type: String,
      default: "#7c3aed",
      trim: true,
    },

    buttonTextColor: {
      type: String,
      default: "#ffffff",
      trim: true,
    },

    // ==================================================
    // Visibility and scheduling
    // ==================================================

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    startAt: {
      type: Date,
      default: null,
      index: true,
    },

    endAt: {
      type: Date,
      default: null,
      index: true,
    },

    /**
     * Larger values appear before smaller values.
     */
    priority: {
      type: Number,
      default: 1,
      index: true,
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

// Active banner lookup for Movie or TV Home.
homeBannerSchema.index({
  mediaType: 1,
  isActive: 1,
  priority: -1,
  createdAt: -1,
});

// Scheduled active-banner lookup.
homeBannerSchema.index({
  mediaType: 1,
  isActive: 1,
  startAt: 1,
  endAt: 1,
  priority: -1,
});

// Admin/banner-management ordering.
homeBannerSchema.index({
  isActive: 1,
  updatedAt: -1,
});

// ======================================================
// Validation and normalization
// ======================================================

homeBannerSchema.pre(
  "validate",
  function normalizeHomeBanner(next) {
    try {
      const trimFields = [
        "title",
        "subtitle",
        "image",
        "buttonText",
        "designType",
        "actionType",
        "actionValue",
        "backgroundColor",
        "textColor",
        "buttonColor",
        "buttonTextColor",
      ];

      for (const field of trimFields) {
        if (typeof this[field] === "string") {
          this[field] = this[field].trim();
        }
      }

      if (!this.title) {
        this.invalidate(
          "title",
          "A Home Banner title is required."
        );
      }

      const actionNeedsValue = [
        "screen",
        "movie",
        "show",
        "actor",
        "director",
        "cinematographer",
        "list",
        "url",
      ].includes(this.actionType);

      if (actionNeedsValue && !this.actionValue) {
        this.invalidate(
          "actionValue",
          `${this.actionType} banners require an action value.`
        );
      }

      if (this.actionType === "none") {
        this.actionValue = "";
      }

      if (this.actionType === "episode") {
        const metadata = this.actionMetadata || {};

        const hasEpisodeIdentity =
          Number.isInteger(metadata.showTmdbId) &&
          metadata.showTmdbId > 0 &&
          Number.isInteger(metadata.seasonNumber) &&
          metadata.seasonNumber >= 0 &&
          Number.isInteger(metadata.episodeNumber) &&
          metadata.episodeNumber > 0;

        if (!hasEpisodeIdentity) {
          this.invalidate(
            "actionMetadata",
            "Episode banners require showTmdbId, seasonNumber, and episodeNumber."
          );
        }
      }

      if (
        this.startAt &&
        this.endAt &&
        new Date(this.endAt).getTime() <=
          new Date(this.startAt).getTime()
      ) {
        this.invalidate(
          "endAt",
          "Banner end time must be after its start time."
        );
      }

      if (
        !Number.isFinite(this.priority)
      ) {
        this.priority = 1;
      }

      next();
    } catch (error) {
      next(error);
    }
  }
);

// ======================================================
// Helpful methods and virtuals
// ======================================================

homeBannerSchema.methods.isVisibleAt =
  function isVisibleAt(date = new Date()) {
    if (!this.isActive) {
      return false;
    }

    const timestamp = new Date(date).getTime();

    if (
      this.startAt &&
      timestamp < new Date(this.startAt).getTime()
    ) {
      return false;
    }

    if (
      this.endAt &&
      timestamp >= new Date(this.endAt).getTime()
    ) {
      return false;
    }

    return true;
  };

homeBannerSchema.virtual("hasAction").get(
  function getHasAction() {
    return this.actionType !== "none";
  }
);

homeBannerSchema.set("toJSON", {
  virtuals: true,
});

homeBannerSchema.set("toObject", {
  virtuals: true,
});

// ======================================================
// Export
// ======================================================

module.exports =
  mongoose.models.HomeBanner ||
  mongoose.model("HomeBanner", homeBannerSchema);

