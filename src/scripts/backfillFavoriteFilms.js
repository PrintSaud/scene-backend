// src/scripts/backfillFavoriteFilms.js
const mongoose = require("mongoose");
const axios = require("axios");
require("dotenv").config({ path: ".env" });

const User = require("../models/user");

const uri = process.env.DB_URI;
const TMDB_API_KEY = process.env.TMDB_API_KEY;

async function backfill() {
  await mongoose.connect(uri);
  console.log("✅ Connected to MongoDB");

  const users = await User.find({ "favoriteFilms.0": { $exists: true } });

  for (const user of users) {
    console.log(`\n👤 Processing user: ${user.username}`);
    console.log("Before:", JSON.stringify(user.favoriteFilms, null, 2));

    const enriched = [];

    for (const f of user.favoriteFilms) {
      // 🔑 Use tmdbId if present, otherwise only keep numeric id
      let tmdbId = null;

      if (typeof f.tmdbId === "number") {
        tmdbId = f.tmdbId;
      } else if (typeof f.id === "number") {
        tmdbId = f.id;
      } else if (
        typeof f.id === "string" &&
        /^\d+$/.test(f.id) // string of digits
      ) {
        tmdbId = Number(f.id);
      }

      if (!tmdbId) {
        console.warn("⚠️ Skipping invalid favorite:", {
          id: f.id,
          tmdbId: f.tmdbId,
          title: f.title,
        });
        continue;
      }

      try {
        const { data } = await axios.get(
          `https://api.themoviedb.org/3/movie/${tmdbId}`,
          { params: { api_key: TMDB_API_KEY, language: "en-US" } }
        );

        enriched.push({
          tmdbId,
          title: f.title || data.title,
          poster_path: data.poster_path,
        });
      } catch (err) {
        console.warn(`⚠️ TMDB fetch failed for ${tmdbId}`, err.message);
        enriched.push({
          tmdbId,
          title: f.title,
          poster_path: null,
        });
      }
    }

    if (enriched.length > 0) {
      await User.updateOne(
        { _id: user._id },
        { $set: { favoriteFilms: enriched } }
      );
      console.log("After:", JSON.stringify(enriched, null, 2));
      console.log(`✅ Fixed favorites for ${user.username}`);
    } else {
      console.log(`⚠️ No valid favorites to update for ${user.username}`);
    }
  }

  console.log("\n🎉 Backfill complete");
  process.exit();
}

backfill();
