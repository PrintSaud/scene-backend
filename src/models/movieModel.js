// src/models/movieModel.js
const mongoose = require('mongoose');

const movieSchema = new mongoose.Schema({
  tmdbId: {
    type: Number,
    required: true,
    unique: true,
    index: true
  },
  title: {
    type: String,
    required: true
  },
  overview: {
    type: String
  },
  posterPath: {
    type: String
  },
  releaseDate: {
    type: Date
  },
  genres: {
    type: [String],
    default: []
  },
  runtime: {
    type: Number // minutes
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Movie', movieSchema);

