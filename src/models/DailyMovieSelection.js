const mongoose = require("mongoose");

const dailyMovieSelectionSchema = new mongoose.Schema(
  {
    date: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    tmdbId: {
      type: Number,
      required: true,
    },

    title: String,
    overview: String,
    poster_path: String,
    backdrop_path: String,
    rating: Number,
    votes: Number,
    release_date: String,

    source: {
      type: String,
      enum: ["random", "skip", "manual"],
      default: "random",
    },
  },
  {
    timestamps: true,
  }
);

module.exports =
  mongoose.models.DailyMovieSelection ||
  mongoose.model("DailyMovieSelection", dailyMovieSelectionSchema);
