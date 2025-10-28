const express = require("express");
const sceneBotRouter = require("./sceneBot"); // ✅ exact match with your file name

const router = express.Router();

// temporary fix: redirect /api/scene → /api/scene-bot
router.use("/scene", sceneBotRouter);

module.exports = router;
