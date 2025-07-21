// scripts/migrateWatchlistFormat.js

const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const User = require('../models/user');

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB for migration");

    const users = await User.find({
      watchlist: { $exists: true, $ne: [] },
      "watchlist.0": { $type: "int" }  // 🔔 Only legacy watchlists (plain numbers)
    });

    console.log(`🔎 Found ${users.length} user(s) with legacy watchlists`);

    for (const user of users) {
      const oldWatchlist = user.watchlist;
      const newWatchlist = oldWatchlist.map(tmdbId => ({
        tmdbId: tmdbId,
        addedAt: new Date(0)  // Or Date.now() if you prefer recent timestamp
      }));

      user.watchlist = newWatchlist;
      await user.save();

      console.log(`➡️ Migrated ${oldWatchlist.length} items for user ${user.username} (${user._id})`);
    }

    console.log("🎉 Migration complete — all legacy watchlists updated!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
})();
