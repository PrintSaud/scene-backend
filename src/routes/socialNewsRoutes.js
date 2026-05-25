const express = require("express");
const router = express.Router();

const SocialNewsDraft = require("../models/SocialNewsDraft");
const sendTelegramDraft = require("../services/telegramBot");
const generateSocialNews = require("../services/socialNewsGenerator");

router.get("/drafts", async (req, res) => {
    const { status } = req.query;
  
    const query = status ? { status } : {};
  
    const drafts = await SocialNewsDraft.find(query).sort({ createdAt: -1 });
  
    res.json(drafts);
  });

router.post("/generate", async (req, res) => {
    try {
      const result = await generateSocialNews();
  
      res.json({
        success: true,
        message: "Social news generated",
        result,
      });
    } catch (err) {
      console.error("❌ Generate route error:", err.response?.data || err.message);
  
      res.status(500).json({
        success: false,
        error: err.response?.data || err.message,
      });
    }
  });

  router.patch("/:id/approve", async (req, res) => {
    try {
      const draft = await SocialNewsDraft.findByIdAndUpdate(
        req.params.id,
        { status: "approved" },
        { new: true }
      );
  
      if (!draft) {
        return res.status(404).json({ success: false, message: "Draft not found" });
      }
  
      res.json({ success: true, draft });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  
  router.patch("/:id/reject", async (req, res) => {
    try {
      const draft = await SocialNewsDraft.findByIdAndUpdate(
        req.params.id,
        { status: "rejected" },
        { new: true }
      );
  
      if (!draft) {
        return res.status(404).json({ success: false, message: "Draft not found" });
      }
  
      res.json({ success: true, draft });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  
  router.patch("/:id/posted", async (req, res) => {
    try {
      const draft = await SocialNewsDraft.findByIdAndUpdate(
        req.params.id,
        { status: "posted" },
        { new: true }
      );
  
      if (!draft) {
        return res.status(404).json({ success: false, message: "Draft not found" });
      }
  
      res.json({ success: true, draft });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post("/:id/send-telegram", async (req, res) => {
    const draft = await SocialNewsDraft.findById(req.params.id);
  
    if (!draft) {
      return res.status(404).json({ success: false, message: "Draft not found" });
    }
  
    await sendTelegramDraft(draft);
  
    res.json({ success: true, message: "Telegram sent" });
  });


module.exports = router;
