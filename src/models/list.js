const mongoose = require("mongoose");

const ListSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  title: { type: String, required: true },
  description: { type: String },
  coverImage: { type: String },
  isPrivate: { type: Boolean, default: false },
  isRanked: { type: Boolean, default: false },
  movies: [
    {
      id: { type: String, required: true }, // TMDB or internal ID
      title: { type: String, required: true },
      poster: { type: String }, // Optional: for previewing posters
    },
  ],
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  savedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
}, { timestamps: true });

module.exports = mongoose.models.List || mongoose.model("List", ListSchema);
