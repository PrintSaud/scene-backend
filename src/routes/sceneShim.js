const express = require("express");
const router = express.Router();
const sceneBotRoutes = require("./sceneBot");

router.use(express.json()); // ✅ parse JSON for shim

// Forward /api/scene → /api/scene-bot
router.use("/scene", (req, res, next) => {
  req.url = "/";
  sceneBotRoutes(req, res, next);
});

module.exports = router;
