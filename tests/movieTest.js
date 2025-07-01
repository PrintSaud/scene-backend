// tests/movieTest.js
require('dotenv').config();        // ← load your .env
const mongoose = require('mongoose');
const Movie = require('../src/models/movieModel');

console.log('Connecting to:', process.env.DB_URI);  // ← add this line to verify

async function run() {
  try {
    await mongoose.connect(process.env.DB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    const m = await Movie.create({
      tmdbId: 550,
      title: 'Fight Club',
      overview: 'A ticking‑time‑bomb insomniac...',
      posterPath: '/a26cQPRhJPX6GbWfQbvZdrrp9j9.jpg',
      releaseDate: new Date('1999-10-15'),
      genres: ['Drama'],
      runtime: 139
    });
    console.log('✅ Saved movie:', m);
  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
