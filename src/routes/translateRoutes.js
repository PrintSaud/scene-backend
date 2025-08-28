// src/routes/translateRoutes.js
import express from "express";
import axios from "axios";

const router = express.Router();

const GOOGLE_API_KEY = process.env.GOOGLE_TRANSLATE_KEY; // keep it server-side
const URL = `https://translation.googleapis.com/language/translate/v2?key=${GOOGLE_API_KEY}`;

// optional: simple in-memory LRU-ish cache
const CACHE = new Map();
const CACHE_LIMIT = 5000;
function cacheKey(text, target, source, format) {
  return `${target}::${source || "auto"}::${format}::${text}`;
}
function setCache(k, v) {
  if (CACHE.size > CACHE_LIMIT) {
    // delete oldest inserted key
    const first = CACHE.keys().next().value;
    if (first) CACHE.delete(first);
  }
  CACHE.set(k, v);
}

router.post("/", async (req, res) => {
  try {
    let { q, target = "ar", source = undefined, format = "text" } = req.body;

    if (!q) return res.status(400).json({ error: "Missing q" });
    if (!Array.isArray(q)) q = [q];

    // serve cached results where possible
    const out = new Array(q.length);
    const toTranslate = [];
    const indexMap = [];

    q.forEach((text, i) => {
      const key = cacheKey(text, target, source, format);
      if (CACHE.has(key)) {
        out[i] = CACHE.get(key);
      } else {
        toTranslate.push(text);
        indexMap.push(i);
      }
    });

    if (toTranslate.length) {
      const { data } = await axios.post(URL, { q: toTranslate, target, source, format });
      const translations = data?.data?.translations || [];
      translations.forEach((t, j) => {
        const translatedText = t.translatedText;
        const i = indexMap[j];
        out[i] = translatedText;
        setCache(cacheKey(q[i], target, source, format), translatedText);
      });
    }

    return res.json({ translations: out });
  } catch (err) {
    console.error("❌ /api/translate failed:", err?.response?.data || err.message);
    return res.status(500).json({ error: "Translation failed" });
  }
});

export default router;
