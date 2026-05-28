const axios = require("axios");
const crypto = require("crypto");
const OpenAI = require("openai");
const Parser = require("rss-parser");

const SocialNewsDraft = require("../models/SocialNewsDraft");
const sendTelegramDraft = require("./telegramBot");

const parser = new Parser();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Railway-safe logging:
 * - Production only logs important warnings/errors.
 * - Set SOCIAL_NEWS_DEBUG=true locally if you want detailed logs.
 */
const DEBUG_NEWS = process.env.SOCIAL_NEWS_DEBUG === "true";

function debugLog(...args) {
  if (DEBUG_NEWS) console.log(...args);
}

function warnLog(...args) {
  console.warn(...args);
}

function errorLog(...args) {
  console.error(...args);
}

/**
 * Cost protection:
 * This limits how many OpenAI caption calls can happen per cron run.
 * You can change it in Railway env:
 * SOCIAL_NEWS_AI_LIMIT=3
 */
const MAX_AI_CAPTIONS_PER_RUN = Number(process.env.SOCIAL_NEWS_AI_LIMIT || 5);

/**
 * How many articles we keep before scoring.
 * This is NOT how many AI calls happen.
 */
const MAX_COMBINED_ARTICLES = Number(process.env.SOCIAL_NEWS_MAX_ARTICLES || 30);

const RSS_FEEDS = [
  { name: "Variety Film", url: "https://variety.com/v/film/news/feed/" },
  { name: "Deadline Film", url: "https://deadline.com/v/film/feed/" },
  { name: "IndieWire Film", url: "https://www.indiewire.com/c/film/feed/" },
  { name: "The Playlist", url: "https://theplaylist.net/feed/" },
  { name: "FirstShowing", url: "https://www.firstshowing.net/feed/" },
];

const ALLOWED_KEYWORDS = [
  "movie",
  "movies",
  "film",
  "films",
  "cinema",
  "trailer",
  "teaser",
  "first look",
  "poster",
  "clip",
  "behind the scenes",
  "director",
  "directed",
  "filmmaker",
  "box office",
  "festival",
  "oscar",
  "oscars",
  "academy award",
  "cannes",
  "venice",
  "sundance",
  "toronto film festival",
  "release date",
  "released",
  "premiere",
  "screening",
  "cast",
  "casting",
  "actor",
  "actress",
  "voice",
  "voicing",
  "screenplay",
  "screenwriter",
  "studio",
  "a24",
  "neon",
  "netflix",
  "warner bros",
  "universal",
  "universal pictures",
  "paramount",
  "disney",
  "sony pictures",
  "rottentomatoes",
  "rotten tomatoes",
  "horror",
  "sci-fi",
  "animated",
  "animation",
  "sequel",
  "reboot",
  "remake",
  "franchise",
  "rights",
  "deal",
  "bidding",
  "offer",
  "acquired",
  "acquisition",
];

const BLOCKED_KEYWORDS = [
  "pregnant",
  "pregnancy",
  "baby",
  "wife",
  "husband",
  "couples",
  "couple",
  "girlfriend",
  "boyfriend",
  "dating",
  "divorce",
  "marriage",
  "wedding",
  "scandal",
  "gossip",
  "unrecognizable",
  "weight loss",
  "football",
  "soccer",
  "tennis",
  "nba",
  "nfl",
  "mlb",
  "ufc",
  "wwe",
  "ohio state",
  "roster",
  "gay",
  "lesbians",
  "transgender",
];

/**
 * Importance is now less "boring industry" and more:
 * - Would movie fans care?
 * - Is it social/news-feed worthy?
 * - Does it feel like movie internet?
 */
const IMPORTANCE_RULES = [
  // Huge names / franchises
  { keyword: "christopher nolan", score: 30 },
  { keyword: "nolan", score: 20 },
  { keyword: "james bond", score: 35 },
  { keyword: "bond", score: 25 },
  { keyword: "marvel", score: 30 },
  { keyword: "mcu", score: 25 },
  { keyword: "dcu", score: 25 },
  { keyword: "spider-man", score: 30 },
  { keyword: "spiderman", score: 30 },
  { keyword: "star wars", score: 30 },
  { keyword: "dune", score: 30 },
  { keyword: "batman", score: 25 },
  { keyword: "superman", score: 25 },
  { keyword: "x-men", score: 25 },
  { keyword: "pixar", score: 20 },
  { keyword: "a24", score: 20 },
  { keyword: "neon", score: 15 },

  // Fan-friendly updates
  { keyword: "official trailer", score: 25 },
  { keyword: "trailer", score: 18 },
  { keyword: "teaser", score: 18 },
  { keyword: "first look", score: 18 },
  { keyword: "poster", score: 12 },
  { keyword: "clip", score: 12 },
  { keyword: "release date", score: 15 },
  { keyword: "casting", score: 15 },
  { keyword: "cast", score: 12 },
  { keyword: "voicing", score: 15 },
  { keyword: "voice", score: 10 },
  { keyword: "sequel", score: 15 },
  { keyword: "reboot", score: 12 },
  { keyword: "remake", score: 10 },

  // Movie internet / fun marketing
  { keyword: "website", score: 12 },
  { keyword: "interactive", score: 18 },
  { keyword: "viral", score: 18 },
  { keyword: "fan", score: 10 },
  { keyword: "fans", score: 10 },
  { keyword: "campaign", score: 10 },
  { keyword: "marketing", score: 10 },

  // Industry heat, but only if it feels like momentum
  { keyword: "eight-figure", score: 20 },
  { keyword: "seven-figure", score: 12 },
  { keyword: "preemptive", score: 18 },
  { keyword: "bidding", score: 20 },
  { keyword: "bidding war", score: 25 },
  { keyword: "offer", score: 10 },
  { keyword: "deal", score: 12 },
  { keyword: "rights", score: 12 },
  { keyword: "first negotiation rights", score: 18 },
  { keyword: "acquired", score: 12 },
  { keyword: "acquisition", score: 12 },
  { keyword: "studio", score: 8 },
  { keyword: "filmmaker", score: 12 },
  { keyword: "director", score: 10 },

  // Awards / festivals
  { keyword: "oscar", score: 18 },
  { keyword: "oscars", score: 18 },
  { keyword: "academy awards", score: 18 },
  { keyword: "cannes", score: 12 },
  { keyword: "venice", score: 12 },
  { keyword: "sundance", score: 12 },
  { keyword: "festival", score: 8 },

  // Performance / audience relevance
  { keyword: "box office", score: 15 },
  { keyword: "record", score: 10 },
  { keyword: "highest-grossing", score: 15 },
];

const IMPORTANT_NEWS_THRESHOLD = Number(
  process.env.SOCIAL_NEWS_IMPORTANCE_THRESHOLD || 15
);

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function createHash(article) {
  return crypto
    .createHash("md5")
    .update(`${article.title || ""}-${article.url || ""}`)
    .digest("hex");
}

function isCinemaNews(article) {
  const textToCheck = normalizeText(
    `${article.title || ""} ${article.description || ""} ${article.source || ""}`
  );

  const isAllowed = ALLOWED_KEYWORDS.some((word) =>
    textToCheck.includes(word)
  );

  const isBlocked = BLOCKED_KEYWORDS.some((word) =>
    textToCheck.includes(word)
  );

  return isAllowed && !isBlocked;
}

function scoreArticleImportance(article) {
  const text = normalizeText(
    `${article.title || ""} ${article.description || ""} ${article.source || ""}`
  );

  let score = 0;
  const matched = [];

  for (const rule of IMPORTANCE_RULES) {
    if (text.includes(rule.keyword)) {
      score += rule.score;
      matched.push(rule.keyword);
    }
  }

  // Small boost for visual posts because they work better in Scene/Telegram drafts.
  if (article.image) {
    score += 5;
    matched.push("image");
  }

  // Recency boost.
  if (article.publishedAt) {
    const publishedMs = new Date(article.publishedAt).getTime();
    const ageHours = (Date.now() - publishedMs) / (1000 * 60 * 60);

    if (!Number.isNaN(ageHours)) {
      if (ageHours <= 24) {
        score += 8;
        matched.push("fresh");
      } else if (ageHours <= 72) {
        score += 4;
        matched.push("recent");
      }
    }
  }

  return { score, matched };
}

function extractImageFromRssItem(item) {
  return (
    item.enclosure?.url ||
    item["media:content"]?.url ||
    item["media:thumbnail"]?.url ||
    null
  );
}

async function fetchRssArticles() {
  const allArticles = [];

  for (const feed of RSS_FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      const items = parsed.items || [];

      for (const item of items.slice(0, 5)) {
        allArticles.push({
          title: item.title,
          description:
            item.contentSnippet || item.summary || item.content || "",
          source: feed.name,
          url: item.link,
          image: extractImageFromRssItem(item),
          publishedAt: item.isoDate || item.pubDate,
          sourceType: "rss",
        });
      }

      debugLog(`RSS fetched: ${feed.name} — ${items.length} items`);
    } catch (err) {
      warnLog(`RSS failed: ${feed.name} — ${err.message}`);
    }
  }

  return allArticles;
}

async function fetchNewsApiArticles() {
  try {
    if (!process.env.NEWS_API_KEY) {
      debugLog("NEWS_API_KEY missing. Skipping NewsAPI.");
      return [];
    }

    const newsRes = await axios.get("https://newsapi.org/v2/everything", {
      params: {
        q: `
          (
            movie OR movies OR cinema OR film OR trailer OR teaser OR "first look"
            OR "box office" OR "film festival" OR director OR filmmaker OR actor
            OR casting OR studio OR horror OR animation OR sequel OR "release date"
            OR "bidding war" OR "preemptive offer" OR "movie rights"
          )
          NOT sports
          NOT football
          NOT tennis
          NOT pregnant
          NOT baby
          NOT gossip
        `,
        language: "en",
        sortBy: "publishedAt",
        pageSize: 10,
        apiKey: process.env.NEWS_API_KEY,
      },
    });

    const articles = newsRes.data.articles || [];

    debugLog("NewsAPI status:", newsRes.data.status);
    debugLog("NewsAPI articles found:", articles.length);

    return articles.map((article) => ({
      title: article.title,
      description: article.description || "",
      source: article.source?.name,
      url: article.url,
      image: article.urlToImage,
      publishedAt: article.publishedAt,
      sourceType: "newsapi",
    }));
  } catch (err) {
    warnLog("NewsAPI failed:", err.response?.data || err.message);
    return [];
  }
}

function dedupeArticles(articles) {
  const seen = new Set();
  const unique = [];

  for (const article of articles) {
    const key = createHash(article);
    if (seen.has(key)) continue;

    seen.add(key);
    unique.push(article);
  }

  return unique;
}

function cleanCaptionValue(value) {
  return String(value || "").trim();
}

async function writeCaptions(article) {
  const prompt = `
You are the official social media writer for Scene, a modern Saudi movie social platform.

Your job is to turn real cinema/movie industry news into short social media captions.

Write exactly 3 captions:

1. english
- Short English caption.
- Clean, exciting, and social-media friendly.

2. arabic
- Regular Arabic caption.
- Natural Saudi/Gulf Arabic.
- Clear and easy to understand.
- Not too formal.

3. scene
- Scene-styled Arabic caption.
- More energetic, fun, and movie-fan coded.
- It should feel like Scene is posting it.
- Still professional enough for the brand.
- No cringe, no overdoing emojis.

Very important:
- The "arabic" and "scene" captions must both be Arabic.
- "arabic" is the regular Arabic version.
- "scene" is the Scene-style Arabic version.
- Each caption must be under 35 words.
- No spoilers.
- No celebrity gossip.
- No personal-life news unless it directly affects a film/project.
- Only movie/cinema/film industry news.
- Do not invent facts.
- Do not mention Scene unless it sounds natural.
- Prefer posts that feel like movie internet:
  casting, trailers, posters, first looks, interactive marketing, fan discussion, filmmaker momentum, studio bidding, festival buzz, awards, horror news, animation news, and major franchise updates.
- Avoid boring corporate phrasing.

If the article is not truly movie/cinema news, return:
{
  "skip": true,
  "reason": "not cinema news"
}

Return ONLY valid JSON.
No markdown.
No explanation.

Expected JSON:
{
  "english": "...",
  "arabic": "...",
  "scene": "..."
}

News:
Title: ${article.title || ""}

Description:
${article.description || ""}

Source:
${article.source || ""}
`;

  const response = await openai.chat.completions.create({
    model: process.env.SOCIAL_NEWS_OPENAI_MODEL || "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.75,
  });

  const rawText = response.choices[0]?.message?.content || "";

  try {
    const parsed = JSON.parse(rawText);

    if (parsed.skip) {
      return parsed;
    }

    return {
      english: cleanCaptionValue(parsed.english),
      arabic: cleanCaptionValue(parsed.arabic),
      scene: cleanCaptionValue(parsed.scene),
    };
  } catch {
    // Fallback should almost never happen, but keeps the cron from crashing.
    return {
      english: cleanCaptionValue(rawText),
      arabic: cleanCaptionValue(rawText),
      scene: cleanCaptionValue(rawText),
    };
  }
}

async function generateSocialNews() {
  try {
    const rssArticles = await fetchRssArticles();
    const newsApiArticles = await fetchNewsApiArticles();

    const articles = dedupeArticles([...rssArticles, ...newsApiArticles])
      .filter((article) => article.title && article.url)
      .map((article) => {
        const importance = scoreArticleImportance(article);
        return {
          ...article,
          _importanceScore: importance.score,
          _importanceMatched: importance.matched,
        };
      })
      .sort((a, b) => b._importanceScore - a._importanceScore)
      .slice(0, MAX_COMBINED_ARTICLES);

    debugLog("Social news combined articles:", articles.length);
    debugLog("Top social news article:", articles[0]?.title);

    let created = 0;
    let skipped = 0;
    let lowImportanceSkipped = 0;
    let telegramSent = 0;
    let aiCallsUsed = 0;

    for (const article of articles) {
      if (!isCinemaNews(article)) {
        skipped += 1;
        debugLog("Skipped non-cinema article:", article.title);
        continue;
      }

      const importance = {
        score: article._importanceScore || 0,
        matched: article._importanceMatched || [],
      };

      if (importance.score < IMPORTANT_NEWS_THRESHOLD) {
        skipped += 1;
        lowImportanceSkipped += 1;
        debugLog(
          `Skipped low-importance article (${importance.score}): ${article.title}`
        );
        continue;
      }

      const hash = createHash(article);
      const exists = await SocialNewsDraft.findOne({ hash });

      if (exists) {
        skipped += 1;
        debugLog("Skipped duplicate article:", article.title);
        continue;
      }

      if (aiCallsUsed >= MAX_AI_CAPTIONS_PER_RUN) {
        skipped += 1;
        debugLog(
          `AI caption limit reached (${MAX_AI_CAPTIONS_PER_RUN}). Skipping remaining articles.`
        );
        continue;
      }

      aiCallsUsed += 1;

      const captions = await writeCaptions(article);

      if (captions.skip) {
        skipped += 1;
        debugLog("AI skipped article:", article.title, captions.reason);
        continue;
      }

      let savedDraft;

      try {
        savedDraft = await SocialNewsDraft.create({
          title: article.title,
          source: article.source,
          url: article.url,
          image: article.image,

          captions: {
            english: captions.english || "",
            arabic: captions.arabic || "",
            scene: captions.scene || "",
          },

          importanceScore: importance.score,
          importanceMatched: importance.matched,

          hash,
          status: "draft",
        });
      } catch (dbErr) {
        if (dbErr.code === 11000) {
          skipped += 1;
          debugLog("Duplicate hash race condition:", article.title);
          continue;
        }

        throw dbErr;
      }

      created += 1;

      try {
        await sendTelegramDraft(savedDraft);
        telegramSent += 1;
      } catch (telegramErr) {
        errorLog(
          "Telegram send failed:",
          telegramErr.response?.data || telegramErr.message
        );
      }
    }

    const result = {
      rssFound: rssArticles.length,
      newsApiFound: newsApiArticles.length,
      combinedFound: articles.length,
      draftsCreated: created,
      skipped,
      lowImportanceSkipped,
      telegramSent,
      aiCallsUsed,
      aiLimit: MAX_AI_CAPTIONS_PER_RUN,
    };

    debugLog("Social news complete:", result);

    return result;
  } catch (err) {
    errorLog("Social news error:", err.response?.data || err.message);
    throw err;
  }
}

module.exports = generateSocialNews;

