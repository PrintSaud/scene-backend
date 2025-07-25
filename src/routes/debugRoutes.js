const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Log = require("../models/log");

// ⚠️ TEMP ROUTE — Only use once
router.delete("/cleanup-logs", async (req, res) => {
  try {
    const result = await Log.deleteMany({
      user: new mongoose.Types.ObjectId("68666f7a7b759477f069c7af"),
      importedFrom: "letterboxd",
    });

    res.json({
      message: "🧼 Cleaned up imported logs!",
      deleted: result.deletedCount,
    });
  } catch (err) {
    console.error("Cleanup error:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// ⚠️ TEMP ROUTE — Delete logs before July 3, 2025
// ⚠️ TEMP ROUTE — Delete logs only from July 25, 2025
router.delete("/delete-july-25-logs", async (req, res) => {
    try {
      const start = new Date("2025-07-26T00:00:00.000Z");
      const end = new Date("2025-07-27T00:00:00.000Z");
  
      const result = await Log.deleteMany({
        user: new mongoose.Types.ObjectId("6883eae4b18d87a94cd4bcb5"),
        createdAt: { $gte: start, $lt: end },
      });
  
      res.json({
        message: "🧼 Deleted logs created on July 26, 2025!",
        deleted: result.deletedCount,
      });
    } catch (err) {
      console.error("Cleanup error:", err);
      res.status(500).json({ error: "Something went wrong" });
    }
  });
  
  

module.exports = router;
