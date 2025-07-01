const mongoose = require("mongoose");

const sceneBotUsageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  date: { type: String, required: true }, // e.g. "2025-06-20"
  count: { type: Number, default: 0 },
});

sceneBotUsageSchema.index({ userId: 1, date: 1 }, { unique: true });

const SceneBotUsage = mongoose.models.SceneBotUsage || mongoose.model("SceneBotUsage", sceneBotUsageSchema);

module.exports = SceneBotUsage;
