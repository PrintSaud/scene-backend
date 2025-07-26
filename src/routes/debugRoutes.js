const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Log = require("../models/log");

dotenv.config(); // ✅ Load .env with DB_URI

const DB_URI = process.env.DB_URI;

mongoose.connect(DB_URI)
  .then(() => {
    console.log("✅ Connected to MongoDB");
    return deleteOldLogs();
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
  });

async function deleteOldLogs() {
  try {
    const deleted = await Log.deleteMany({
      $or: [
        { watchedAt: { $lt: new Date("2025-07-03T00:00:00.000Z") } },
        {
          watchedAt: {
            $gte: new Date("2025-07-25T00:00:00.000Z"),
            $lt: new Date("2025-07-27T00:00:00.000Z"),
          },
        },
      ],
    });

    console.log(`🧨 Deleted ${deleted.deletedCount} logs`);
  } catch (err) {
    console.error("❌ Cleanup error:", err);
  } finally {
    mongoose.disconnect();
  }
}

module.exports = router;
