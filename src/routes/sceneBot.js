const express = require("express");
const dayjs = require("dayjs");
const protect = require("../middleware/authMiddleware");
const openai = require("../utils/openai");
const SceneBotUsage = require("../models/sceneBotUsage");

const router = express.Router();
const userLangPrefs = {}; // 🧠 In-memory language memory per user
const conversationMap = {}; // userId => messages[]

// 🎬 Freeform Film Expert Mode
router.post("/", async (req, res, next) => {
  console.log("🟢 Entered SceneBot route");
  console.log("🟢 OpenAI key exists?", !!process.env.OPENAI_API_KEY);

  const { message, lang } = req.body;
  console.log("🟢 Incoming request body:", { message, lang });

  // ✅ Check token: either normal auth or Apple review token
  let user;
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  console.log("🟢 Authorization header token:", token);

  if (token === process.env.SCENEBOT_SECRET) {
    console.log("🟢 Using SCENEBOT_SECRET token -> bypass normal auth");
    user = { _id: "apple-review", username: "Apple Reviewer" };
  } else {
    console.log("🟢 Using normal auth middleware");
    await new Promise((resolve, reject) => {
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
    console.log("🟢 Checking usage for user:", user._id, "date:", today);
    let usage = await SceneBotUsage.findOne({ userId: user._id, date: today });
    if (!usage) {
      console.log("🟢 No usage record found for today, creating one");
      usage = await SceneBotUsage.create({ userId: user._id, date: today, count: 0 });
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
      console.log("🟢 Initializing conversation map for user");
      conversationMap[user._id] = [
        { role: "system", content: `${systemPrompt}\n\n${assistantIntro}` },
      ];
    }

    conversationMap[user._id].push({ role: "user", content: rewrittenMessage });
    console.log("🟢 Messages sent to GPT:", conversationMap[user._id]);

    console.log("🟢 Sending request to OpenAI...");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: conversationMap[user._id],
      temperature: 0.8,
      max_tokens: 800,
    });
    console.log("🟢 Received response from OpenAI");

    usage.count += 1;
    await usage.save();

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


// 🌐 Translate Fun Prompt
router.post("/translate", protect, async (req, res) => {
  const { text, target } = req.body;

  if (!text || !target) {
    return res.status(400).json({ message: "Missing text or target language." });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: `Translate this sentence to ${target} language.` },
        { role: "user", content: text },
      ],
      temperature: 0.2,
      max_tokens: 300,
    });

    const translated = completion.choices[0].message.content;
    res.json({ translated });
  } catch (err) {
    console.error("❌ Translation error:", err);
    res.status(500).json({ message: "Translation failed." });
  }
});

// --- Health check route ---
router.get("/health", async (req, res) => {
  try {
    return res.json({ status: "ok" });
  } catch (err) {
    console.error("Health route error:", err);
    return res.status(500).json({ status: "error" });
  }
});

// 🚀 Token endpoint for Apple review / temporary usage
router.post("/token", async (req, res) => {
  const { secret } = req.body;

  if (secret !== process.env.SCENEBOT_SECRET) {
    return res.status(401).json({ error: "Invalid secret" });
  }

  // generate a temporary token (can be JWT or random string)
  const token = Math.random().toString(36).substring(2) + "flick"; 
  res.json({ token });
});

module.exports = router;
