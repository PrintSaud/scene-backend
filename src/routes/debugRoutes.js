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

module.exports = router;
