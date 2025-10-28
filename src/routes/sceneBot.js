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

// 🎬 Freeform Film Expert Mode
router.post("/", async (req, res) => {
  console.log("🟢 SceneBot POST hit", req.headers.authorization, req.body);

  const { message: rawMessage, lang } = req.body || {};
  const message = typeof rawMessage === "string" ? rawMessage : JSON.stringify(rawMessage || "");
  console.log("🟢 Incoming request body:", { message, lang });

  if (!message || message.trim() === "") {
    console.log("🟢 Empty message received");
    return res.status(400).json({ message: "❗ You must enter a message." });
  }

  let user;
  const authHeader = req.headers.authorization || "";
  const origin = req.headers.origin || "";
  const oldFrontendAllowed = origin.includes("scenesa.com") || origin.includes("localhost:5173");
  const reviewSecret = process.env.SCENEBOT_SECRET || "supersecretstring123";
  
  // ---------------------------
  // BYPASS: no token / invalid token / old frontend
  // ---------------------------
  if (!authHeader || authHeader.trim() === "" || oldFrontendAllowed) {
    console.log("🟡 TEMP BYPASS: SceneBot called without valid token");
    user = { _id: "scene-bot-user", username: "Bypass User", isReviewBypass: true };
  }
  
  // ---------------------------
  // Normal JWT auth
  // ---------------------------
  if (!user) {
    try {
      await new Promise((resolve) => {
        protect(req, res, () => {
          user = req.user;
          resolve();
        });
      });
      if (!user) {
        // Instead of sending 401, fallback to bypass user
        console.log("🟡 Auth failed, falling back to bypass user");
        user = { _id: "scene-bot-user", username: "Bypass User", isReviewBypass: true };
      }
    } catch (err) {
      console.log("🟡 Auth middleware error, using bypass user", err?.message);
      user = { _id: "scene-bot-user", username: "Bypass User", isReviewBypass: true };
    }
  }
  

  // ---------------------------
  // Normal JWT auth
  // ---------------------------
  if (!user) {
    try {
      await new Promise((resolve) => {
        protect(req, res, () => {
          user = req.user;
          resolve();
        });
      });
      if (!user) return; // protect already sent 401 if invalid
    } catch (err) {
      console.error("❌ Auth failed:", err);
      return res.status(401).json({ message: "Token is invalid or expired" });
    }
  }

  try {
    // ===== Usage tracking (skip for bypass users) =====
    let usage = null;
    const today = dayjs().format("YYYY-MM-DD");
    if (!user.isReviewBypass) {
      usage = await SceneBotUsage.findOne({ userId: user._id, date: today });
      if (!usage) usage = await SceneBotUsage.create({ userId: user._id, date: today, count: 0 });
    }

    // ===== Language preference =====
    const lower = message.toLowerCase();
    if (lower.includes("reply in english")) userLangPrefs[user._id] = "english";
    else if (lower.includes("reply in arabic")) userLangPrefs[user._id] = "arabic";
    else if (lower.includes("reply in french")) userLangPrefs[user._id] = "french";
    else if (lower.includes("reset language")) delete userLangPrefs[user._id];
    const langPref = userLangPrefs[user._id] || lang || "english";
    console.log("🟢 Language preference for user:", langPref);

    // ===== System prompt =====
    const introMap = {
      english: "Sure! Let’s dive into the world of movies 🍿🎬",
      arabic: "أكيد! لنغوص في عالم الأفلام 🍿🎬",
      french: "Bien sûr ! Plongeons dans le monde du cinéma 🍿🎬",
    };
    const assistantIntro = introMap[langPref] || introMap.english;

    const systemPrompt = `You are SceneBot — a smart, casual, and fun film expert on a movie social platform. 
Always respond in fluent ${langPref}. Do NOT mention your training data, OpenAI, capabilities, or limitations. 
Only respond to movie-related questions, suggestions, trivia, or ideas. Your tone should be creative, friendly, and conversational.`;

    const rewrittenMessage = `${message}

🚫 NEVER say anything about your training data, capabilities, or limitations.
❌ Do NOT mention the year your data ends (like "I was trained until October 2023").
✅ You are not an AI — you are just a film expert having a human conversation.
🎬 Respond with a direct, helpful, or creative film-related answer — like a real person would.
🧠 IMPORTANT: Avoid robotic answers or generic disclaimers. Be fun, smart, and purely about cinema.`;

    // ===== Conversation map =====
    if (!conversationMap[user._id]) {
      console.log("🟢 Initializing conversation map for user:", user._id);
      conversationMap[user._id] = [
        { role: "system", content: `${systemPrompt}\n\n${assistantIntro}` },
      ];
    }
    conversationMap[user._id].push({ role: "user", content: rewrittenMessage });
    console.log("🟢 Messages sent to OpenAI (length):", conversationMap[user._id].length);

    // ===== OpenAI request =====
    console.log("🟢 Sending request to OpenAI...");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: conversationMap[user._id],
      temperature: 0.8,
      max_tokens: 800,
    });
    console.log("🟢 Received response from OpenAI");

    if (usage) {
      usage.count += 1;
      await usage.save();
      console.log("🟢 Usage incremented and saved for user:", user._id);
    }

    let reply = completion.choices?.[0]?.message?.content;
    if (typeof reply !== "string") reply = typeof reply === "object" ? JSON.stringify(reply) : String(reply);

    conversationMap[user._id].push({ role: "assistant", content: reply });
    conversationMap[user._id] = conversationMap[user._id].slice(-8); // keep last 8 messages

    console.log("✅ Final reply to client:", reply);
    res.json({ reply });
  } catch (err) {
    console.error("❌ SceneBot error caught:", err);
    if (!process.env.OPENAI_API_KEY) console.error("❌ OpenAI API key is missing!");
    res.status(500).json({ message: "SceneBot is temporarily unavailable. Please try again later." });
  }
});



// --- Health check ---
router.get("/health", async (req, res) => res.json({ status: "ok" }));

router.post("/token", async (req, res) => {
  const { secret } = req.body;

  if (secret !== process.env.SCENEBOT_SECRET) {
    return res.status(401).json({ error: "Invalid secret" });
  }

  const token = jwt.sign(
    { bot: "scene-bot-user" },
    process.env.SCENEBOT_JWT_KEY,
    { expiresIn: "1h" }
  );

  res.json({ token });
});

module.exports = router;
