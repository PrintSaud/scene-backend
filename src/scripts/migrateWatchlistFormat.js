// scripts/migrateWatchlistFormat.js

const mongoose = require("mongoose");
const User = require("../models/user");  // Adjust path if needed

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/your-db-name";

(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB");

    const users = await User.find({ "watchlist.0": { $exists: true } });

    let updatedCount = 0;

    for (const user of users) {
      let modified = false;

      const newWatchlist = user.watchlist.map((item) => {
        if (typeof item === "number") {
          modified = true;
          return { tmdbId: item, addedAt: new Date() };
        } else if (typeof item === "object" && !item.tmdbId && item._id) {
          modified = true;
          return { tmdbId: parseInt(item._id, 10), addedAt: item.addedAt || new Date() };
        }
        return item;
      });

      if (modified) {
        user.watchlist = newWatchlist;
        await user.save();
        updatedCount++;
      }
    }

    console.log(`🎉 Migration complete. Users updated: ${updatedCount}`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
})();
