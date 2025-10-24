// filename: routes/sceneBot.js
const express = require("express");
const dayjs = require("dayjs");
const jwt = require("jsonwebtoken");
const protect = require("../middleware/authMiddleware");
const openai = require("../utils/openai");
const SceneBotUsage = require("../models/sceneBotUsage");

const router = express.Router();
const userLangPrefs = {};       // 🧠 In-memory language memory per user
const conversationMap = {};     // userId => messages[]

router.post("/", async (req, res) => {
  console.log("🟢 Entered SceneBot route");

  const { message, lang } = req.body;
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  console.log("🟢 Authorization header token:", token ? "[REDACTED]" : "(none)");

  let user;

  if (token && process.env.SCENEBOT_SECRET && token === process.env.SCENEBOT_SECRET) {
    // Apple-review bypass
    console.log("🟢 Using SCENEBOT_SECRET token -> bypass normal auth (apple-review)");
    user = { _id: "apple-review", username: "Apple Reviewer", isReviewBypass: true };
  } else if (token) {
    // Verify JWT token
    try {
      const decoded = jwt.verify(token, process.env.SCENEBOT_JWT_KEY);
      if (decoded.bot === "scene") {
        console.log("🟢 JWT verified successfully");
        user = { _id: "scene-bot-user", username: "SceneBot JWT User" };
      } else {
        console.log("🛑 JWT invalid payload:", decoded);
        return res.status(401).json({ error: "Token is invalid" });
      }
    } catch (err) {
      console.error("❌ JWT verification failed:", err.message);
      return res.status(401).json({ error: "Token is invalid or expired" });
    }
  } else {
    // fallback: normal auth middleware
    console.log("🟢 Using normal auth middleware");
    await new Promise((resolve) => {
      protect(req, res, () => {
        user = req.user;
        resolve();
      });
    });
    if (!user) {
      console.log("🟢 User not found after protect middleware. Aborting.");
      return; // protect already sent 401 if invalid
    }
  }

  // ✅ Validate message
  if (typeof message !== "string") {
    console.error("🛑 SERVER BLOCK: message is NOT a string — Actual type:", typeof message);
    return res.status(400).json({ message: "❌ message must be a plain string" });
  }
  if (!message.trim()) {
    return res.status(400).json({ message: "❗ You must enter a message." });
  }

  try {
    // Usage tracking (skip for Apple review or JWT user)
    let usage = null;
    if (!user.isReviewBypass) {
      const today = dayjs().format("YYYY-MM-DD");
      usage = await SceneBotUsage.findOne({ userId: user._id, date: today });
      if (!usage) {
        usage = await SceneBotUsage.create({ userId: user._id, date: today, count: 0 });
      }
    }

    // Language preferences
    const lower = message.toLowerCase();
    if (lower.includes("reply in english")) userLangPrefs[user._id] = "english";
    else if (lower.includes("reply in arabic")) userLangPrefs[user._id] = "arabic";
    else if (lower.includes("reply in french")) userLangPrefs[user._id] = "french";
    else if (lower.includes("reset language")) delete userLangPrefs[user._id];

    const langPref = userLangPrefs[user._id] || lang || "english";
    const introMap = {
      english: "Sure! Let’s dive into the world of movies 🍿🎬",
      arabic: "أكيد! لنغوص في عالم الأفلام 🍿🎬",
      french: "Bien sûr ! Plongeons dans le monde du cinéma 🍿🎬",
    };
    const assistantIntro = introMap[langPref] || introMap.english;

    const systemPrompt = `You are SceneBot — a smart, casual, and fun film expert. Always respond in fluent ${langPref}. Do NOT mention your training data or AI capabilities.`;

    const rewrittenMessage = `${message}

🚫 NEVER say anything about your training data, capabilities, or limitations.
❌ Do NOT mention your training data or AI.
✅ You are not an AI — you are just a film expert having a human conversation.
🎬 Respond with a direct, helpful, or creative film-related answer — like a real person would.`;

    if (!conversationMap[user._id]) {
      conversationMap[user._id] = [
        { role: "system", content: `${systemPrompt}\n\n${assistantIntro}` },
      ];
    }

    conversationMap[user._id].push({ role: "user", content: rewrittenMessage });

    // Call OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: conversationMap[user._id],
      temperature: 0.8,
      max_tokens: 800,
    });

    // Increment usage
    if (usage) {
      usage.count += 1;
      await usage.save();
    }

    let reply = completion.choices?.[0]?.message?.content || "";
    conversationMap[user._id].push({ role: "assistant", content: reply });
    conversationMap[user._id] = conversationMap[user._id].slice(-8); // keep history lean

    res.json({ reply });
  } catch (err) {
    console.error("❌ SceneBot error:", err);
    res.status(500).json({ message: "SceneBot is currently unavailable. Please try again later." });
  }
});

// --- Health check ---
router.get("/health", async (req, res) => res.json({ status: "ok" }));

// --- Token generation ---
router.post("/token", async (req, res) => {
  const { secret } = req.body;
  if (secret !== process.env.SCENEBOT_SECRET) return res.status(401).json({ error: "Invalid secret" });

  const token = jwt.sign(
    { bot: "scene" },
    process.env.SCENEBOT_JWT_KEY,
    { expiresIn: "1h" }
  );
  res.json({ token });
});

module.exports = router;
