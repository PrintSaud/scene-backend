const mongoose = require("mongoose");

const socialNewsDraftSchema = new mongoose.Schema(
  {
    title: String,
    source: String,
    url: String,
    image: String,

    captions: {
      english: String,
      arabic: String,
      scene: String,
    },

    hash: {
      type: String,
      unique: true,
    },

    status: {
      type: String,
      enum: ["draft", "approved", "rejected", "posted"],
      default: "draft",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "SocialNewsDraft",
  socialNewsDraftSchema
);
