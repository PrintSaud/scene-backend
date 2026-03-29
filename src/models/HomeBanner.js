const mongoose = require("mongoose");

const homeBannerSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    subtitle: {
      type: String,
      default: "",
      trim: true,
    },
    image: {
      type: String,
      default: "",
      trim: true,
    },
    buttonText: {
      type: String,
      default: "",
      trim: true,
    },

    // actionType examples:
    // "screen" | "movie" | "actor" | "director" | "cinematographer" | "url"
    actionType: {
      type: String,
      default: "screen",
      trim: true,
    },
    actionValue: {
      type: String,
      default: "",
      trim: true,
    },

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

    isActive: {
      type: Boolean,
      default: true,
    },

    startAt: {
      type: Date,
      default: null,
    },
    endAt: {
      type: Date,
      default: null,
    },

    priority: {
      type: Number,
      default: 1,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("HomeBanner", homeBannerSchema);