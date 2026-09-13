const mongoose = require("mongoose");

const mediaSearchOverrideSchema = new mongoose.Schema(
  {
    tmdbId: {
      type: Number,
      required: true,
      index: true,
    },

    mediaType: {
      type: String,
      enum: ["movie", "tv"],
      required: true,
      index: true,
    },

    action: {
      type: String,
      enum: ["allow", "block"],
      required: true,
    },

    reason: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

mediaSearchOverrideSchema.index(
  {
    tmdbId: 1,
    mediaType: 1,
  },
  {
    unique: true,
  }
);

module.exports =
  mongoose.models.MediaSearchOverride ||
  mongoose.model(
    "MediaSearchOverride",
    mediaSearchOverrideSchema
  );
