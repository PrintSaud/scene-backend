const mongoose = require("mongoose");
const Log = require("../models/log"); // adjust path if needed

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

async function cleanBrokenLogs() {
  const result = await Log.deleteMany({
    $or: [
      { movie: { $exists: false } },
      { movie: { $in: [null, "NaN", "undefined"] } },
      { movie: NaN }
    ]
  });
  console.log(`🧹 Cleaned ${result.deletedCount} broken logs.`);
  mongoose.disconnect();
}

cleanBrokenLogs();
