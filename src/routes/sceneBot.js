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
router.post("/", async (req, res, next) => {
  console.log("🟢 Entered SceneBot route");
  console.log("🟢 OpenAI key exists?", !!process.env.OPENAI_API_KEY);


  const { message, lang } = req.body || {};
  const userMessage = typeof message === 'string' ? message : JSON.stringify(message);
  console.log("🟢 Incoming request body:", { message, lang });

  // ✅ Check token: either normal auth or SCENEBOT_SECRET bypass
    // ---------------------------
  // AUTH: SCENEBOT_SECRET or JWT
  // ---------------------------
  let user;
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  console.log("🟢 Authorization header token:", token ? "[REDACTED]" : "(none)");

  if (token && process.env.SCENEBOT_SECRET && token === process.env.SCENEBOT_SECRET) {
    // exact string bypass (keeps backwards compatibility)
    console.log("🟢 Using SCENEBOT_SECRET token -> bypass normal auth (apple-review)");
    user = { _id: "scene-bot-user", username: "Apple Reviewer", isReviewBypass: true };
  } else if (token) {
    // token present — attempt to verify as JWT signed with SCENEBOT_JWT_KEY
    try {
      const decoded = jwt.verify(token, process.env.SCENEBOT_JWT_KEY);
      console.log("🟢 JWT verified successfully:", decoded);
      // optional: validate payload if you expect e.g. decoded.bot === 'scene'
      if (decoded && decoded.bot) {
        user = { _id: "scene-bot-user", username: "Apple Reviewer", isReviewBypass: true };
      } else {
        console.warn("🟡 JWT missing expected payload; falling back to normal auth");
      }
    } catch (err) {
      console.error("❌ JWT verification failed:", err.message);
      // do NOT return here — fall back to normal auth which may handle other tokens
      // but if you prefer to reject invalid JWTs immediately, uncomment:
      // return res.status(401).json({ error: "Token is invalid or expired" });
    }
  }

  if (!user) {
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


  // ✅ Check if message is a plain string
  console.log("🟢 Checking message type...");
  if (typeof message !== "string") {
    console.error("🛑 SERVER BLOCK: message is NOT a string — Actual type:", typeof message);
    console.trace();
    return res.status(400).json({ message: "❌ message must be a plain string" });
  }

  // ✅ Try parsing to detect if it's a stringified object
  try {
    const maybeObject = JSON.parse(message);
    if (typeof maybeObject === "object") {
      console.warn("🚨 message is a STRINGIFIED OBJECT:", maybeObject);
      return res.status(400).json({ message: "❌ message cannot be a stringified object" });
    }
  } catch (e) {
    console.log("🟢 message is a clean string. Safe to continue.");
  }

  const today = dayjs().format("YYYY-MM-DD");

  if (!message || message.trim() === "") {
    console.log("🟢 Empty message received");
    return res.status(400).json({ message: "❗ You must enter a message." });
  }

  try {
    // ===== Usage tracking: SKIP for Apple-review bypass user =====
    let usage = null;
    if (user.isReviewBypass) {
      console.log("🟢 Skipping DB usage logging for review bypass user:", user._id);
    } else {
      console.log("🟢 Checking usage for user:", user._id, "date:", today);
      usage = await SceneBotUsage.findOne({ userId: user._id, date: today });
      if (!usage) {
        console.log("🟢 No usage record found for today, creating one");
        usage = await SceneBotUsage.create({ userId: user._id, date: today, count: 0 });
      }
    }

    // Language overrides
    const lower = message.toLowerCase();
    if (lower.includes("reply in english")) userLangPrefs[user._id] = "english";
    else if (lower.includes("reply in arabic")) userLangPrefs[user._id] = "arabic";
    else if (lower.includes("reply in french")) userLangPrefs[user._id] = "french";
    else if (lower.includes("reset language")) delete userLangPrefs[user._id];

    const langPref = userLangPrefs[user._id] || lang || "english";
    console.log("🟢 Language preference for user:", langPref);

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

    if (!conversationMap[user._id]) {
      console.log("🟢 Initializing conversation map for user:", user._id);
      conversationMap[user._id] = [
        { role: "system", content: `${systemPrompt}\n\n${assistantIntro}` },
      ];
    }

    conversationMap[user._id].push({ role: "user", content: rewrittenMessage });
    console.log("🟢 Messages sent to OpenAI (length):", conversationMap[user._id].length);

    console.log("🟢 Sending request to OpenAI...");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: conversationMap[user._id],
      temperature: 0.8,
      max_tokens: 800,
    });
    console.log("🟢 Received response from OpenAI");

    // Only increment and save usage for real users
    if (usage) {
      usage.count += 1;
      await usage.save();
      console.log("🟢 Usage incremented and saved for user:", user._id);
    }

    let reply = completion.choices?.[0]?.message?.content;
    console.log("🧠 Raw GPT Reply:", reply);

    if (typeof reply !== "string") {
      reply = typeof reply === "object" ? JSON.stringify(reply) : String(reply);
    }

    // ✅ Save to conversation history
    conversationMap[user._id].push({ role: "assistant", content: reply });
    conversationMap[user._id] = conversationMap[user._id].slice(-8); // keep it lean

    console.log("✅ Final reply to client:", reply);
    res.json({ reply });

  } catch (err) {
    console.error("❌ SceneBot error caught:", err);
    if (!process.env.OPENAI_API_KEY) console.error("❌ OpenAI API key is missing!");
    res.status(500).json({ message: "SceneBot is currently unavailable. Please try again later." });
  }
});



// --- Health check ---
router.get("/health", async (req, res) => res.json({ status: "ok" }));

router.post("/token", async (req, res) => {
  const { secret } = req.body;

  if (secret !== process.env.SCENEBOT_SECRET) {
    return res.status(401).json({ error: "Invalid secret" });
  }

  // ✅ Use a proper JWT with a shared secret
  const token = jwt.sign(
    { bot: "scene-bot-user" },          // payload (can identify SceneBot)
    process.env.SCENEBOT_JWT_KEY,       // make sure this exists in your .env
    { expiresIn: "1h" }                 // 1 hour expiration
  );

  res.json({ token });
});

module.exports = router;
