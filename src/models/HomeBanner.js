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

    // Banner visual design:
    // "text"  = text only
    // "image" = text + photo
    // "link"  = text + button/link
    // "movie" = text + movie navigation
    designType: {
      type: String,
      enum: ["text", "image", "link", "movie"],
      default: "text",
      trim: true,
    },

    // actionType examples:
    // "none" | "screen" | "movie" | "actor" | "director" | "cinematographer" | "url"
    actionType: {
      type: String,
      enum: [
        "none",
        "screen",
        "movie",
        "actor",
        "director",
        "cinematographer",
        "url",
      ],
      default: "none",
      trim: true,
    },

    // Examples:
    // movie: "550"
    // url: "https://scenesa.com/post/..."
    // screen: "Trending"
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

