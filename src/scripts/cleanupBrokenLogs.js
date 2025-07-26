const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Log = require("../models/log");
const CustomPoster = require("../models/customPoster");
const User = require("../models/user");

dotenv.config();

mongoose.connect(process.env.DB_URI).then(async () => {
  console.log("✅ Connected to MongoDB");

  // 🧹 CLEAN BROKEN LOGS
  const logsResult = await Log.deleteMany({
    $or: [
      { movie: { $exists: false } },
      { movie: null },
      { movie: "NaN" },
      { movie: "undefined" },
      { movie: { $type: "string", $regex: "^[0-9]+$" } },
    ],
  });
  console.log(`🧹 Cleaned ${logsResult.deletedCount} broken logs.`);

  // 🧽 CLEAN BROKEN CUSTOM POSTERS
  // 🧽 CLEAN BROKEN CUSTOM POSTERS
const postersResult = await CustomPoster.deleteMany({
    $or: [
      { movieId: { $exists: false } },
      { movieId: null },
      { movieId: { $type: "string" } }, // wrongly stored as string
      { movieId: { $type: "double" }, $expr: { $ne: ["$movieId", "$movieId"] } }, // NaN check
      { movieId: { $lt: 1 } }, // invalid (negative or 0)
    ],
  });
  console.log(`🧽 Cleaned ${postersResult.deletedCount} broken custom posters.`);
  

  // 🛠️ CLEAN USER WATCHLISTS
  const users = await User.find({});
  let cleanedUsers = 0;

  for (const user of users) {
    const cleanWatchlist = (user.watchlist || []).filter((item) => {
      const id = Number(item?.tmdbId || item);
      return !isNaN(id) && id > 0;
    });

    if (cleanWatchlist.length !== user.watchlist.length) {
      user.watchlist = cleanWatchlist;
      await user.save();
      cleanedUsers++;
    }
  }

  console.log(`👤 Cleaned watchlists for ${cleanedUsers} users.`);

  mongoose.disconnect();
});
