const mongoose = require("mongoose");

// Schema for replies
const replySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, default: "" },
  gif: { type: String, default: "" },
  image: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  parentComment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Reply",
    default: null,
  },
});

// Schema for favorite character selected during logging
const favoriteCharacterSchema = new mongoose.Schema(
  {
    characterId: { type: Number, default: null }, // TMDB cast_id or character/person identifier if available
    actorId: { type: Number, default: null }, // TMDB person id
    characterName: { type: String, default: "" }, // Full character name, example: "Tony Stark / Iron Man"
    actorName: { type: String, default: "" }, // Actor name, example: "Robert Downey Jr."
    profilePath: { type: String, default: "" }, // TMDB actor profile path
  },
  { _id: false }
);

// Schema for logs
const logSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    movie: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Movie",
      required: false,
    },

    tmdbId: { type: Number, required: true },
    title: String,
    poster: String,
    backdrop: { type: String, default: "" },

    review: { type: String, default: "" },
    rating: { type: Number, min: 0, max: 5 },

    rewatch: { type: Boolean, default: false },
    rewatchCount: { type: Number, default: 0 },

    watchedAt: { type: Date, default: Date.now },

    gif: { type: String, default: "" },
    image: { type: String, default: "" },

    // ✅ Favorite Character feature
    // Shows later on Review Screen as: #TeamFull Character Name
    favoriteCharacter: {
      type: favoriteCharacterSchema,
      default: null,
    },

    replies: [replySchema],

    parentComment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reply",
      default: null,
    },

    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    customBackdrop: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Log || mongoose.model("Log", logSchema);

