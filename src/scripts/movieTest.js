require("dotenv").config(); // Load environment variables
const mongoose = require("mongoose");
const Movie = require("../models/movieModel");

// 💣 Safety check: Never connect if DB_URI is missing
if (!process.env.DB_URI) {
  console.error("❌ DB_URI is missing. Exiting test...");
  process.exit(1);
}

console.log("🧪 Connecting to:", process.env.DB_URI);

async function run() {
  try {
    await mongoose.connect(process.env.DB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const movie = await Movie.create({
      tmdbId: 550,
      title: "Fight Club",
      overview: "A ticking‑time‑bomb insomniac...",
      posterPath: "/a26cQPRhJPX6GbWfQbvZdrrp9j9.jpg",
      releaseDate: new Date("1999-10-15"),
      genres: ["Drama"],
      runtime: 139,
    });

    console.log("✅ Movie saved to DB:", movie);
  } catch (err) {
    console.error("❌ Error saving movie:", err);
  } finally {
    await mongoose.disconnect();
    console.log("🧼 Disconnected from DB.");
  }
}

run();
