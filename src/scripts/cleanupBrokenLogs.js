const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Log = require("../models/log"); // adjust path if needed

dotenv.config(); // ✅ load .env file

mongoose.connect(process.env.DB_URI, { useNewUrlParser: true, useUnifiedTopology: true });


async function cleanBrokenLogs() {
  const result = await Log.deleteMany({
    $or: [
      { movie: { $exists: false } },
      { movie: { $in: [null, "NaN", "undefined"] } },
      { movie: NaN },
      { movie: { $type: "string", $regex: "^[0-9]+$" } }, // string TMDB IDs
    ],
  });

  console.log(`🧹 Cleaned ${result.deletedCount} broken logs.`);
  mongoose.disconnect();
}

cleanBrokenLogs();
