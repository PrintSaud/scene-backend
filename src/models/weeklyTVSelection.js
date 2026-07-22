// src/models/weeklyTVSelection.js

const mongoose = require("mongoose");

const weeklyTVPickSchema = new mongoose.Schema(
  {
    show: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Show",
      required: true,
      index: true,
    },

    tmdbId: {
      type: Number,
      required: true,
      min: 1,
      index: true,
    },
  },
  {
    _id: false,
  }
);

const weeklyTVSelectionSchema = new mongoose.Schema(
  {
    weekKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },

    startsAt: {
      type: Date,
      required: true,
      index: true,
    },

    refreshesAt: {
      type: Date,
      required: true,
      index: true,
    },

    trending: {
      type: weeklyTVPickSchema,
      required: true,
    },

    airing: {
      type: weeklyTVPickSchema,
      required: true,
    },

    discovery: {
      type: weeklyTVPickSchema,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

weeklyTVSelectionSchema.index(
  { refreshesAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 120 }
);

module.exports =
  mongoose.models.WeeklyTVSelection ||
  mongoose.model(
    "WeeklyTVSelection",
    weeklyTVSelectionSchema
  );
