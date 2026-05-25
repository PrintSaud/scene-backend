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

const RSS_FEEDS = [
  { name: "Variety Film", url: "https://variety.com/v/film/news/feed/" },
  { name: "Deadline Film", url: "https://deadline.com/v/film/feed/" },
  { name: "IndieWire Film", url: "https://www.indiewire.com/c/film/feed/" },
  { name: "The Playlist", url: "https://theplaylist.net/feed/" },
  { name: "FirstShowing", url: "https://www.firstshowing.net/feed/" },
];

const ALLOWED_KEYWORDS = [
  "movie", "movies", "film", "films", "cinema", "trailer", "teaser",
  "director", "directed", "box office", "festival", "oscar", "oscars",
  "academy award", "cannes", "venice", "sundance", "toronto film festival",
  "release date", "released", "premiere", "screening", "cast", "casting",
  "actor", "actress", "screenplay", "screenwriter", "studio", "a24",
  "netflix", "warner bros", "universal pictures", "paramount", "disney",
  "sony pictures", "rottentomatoes", "rotten tomatoes",
];

const BLOCKED_KEYWORDS = [
  "pregnant", "pregnancy", "baby", "wife", "husband", "couples", "couple",
  "girlfriend", "boyfriend", "dating", "divorce", "marriage", "wedding",
  "scandal", "gossip", "unrecognizable", "weight loss", "football", "soccer",
  "tennis", "nba", "nfl", "mlb", "ufc", "wwe", "ohio state", "roster", "Gay",
  "Lesbians",
  "transgender",
];

const IMPORTANCE_RULES = [
  { keyword: "christopher nolan", score: 25 },
  { keyword: "nolan", score: 20 },
  { keyword: "james bond", score: 35 },
  { keyword: "bond", score: 30 },
  { keyword: "marvel", score: 30 },
  { keyword: "mcu", score: 25 },
  { keyword: "dcu", score: 25 },
  { keyword: "spider-man", score: 30 },
  { keyword: "spiderman", score: 30 },
  { keyword: "star wars", score: 30 },
  { keyword: "dune", score: 30 },
  { keyword: "batman", score: 25 },
  { keyword: "pixar", score: 20 },
  { keyword: "oscar", score: 20 },
  { keyword: "oscars", score: 20 },
  { keyword: "academy awards", score: 20 },
  { keyword: "official trailer", score: 20 },
  { keyword: "trailer", score: 15 },
  { keyword: "teaser", score: 15 },
  { keyword: "first look", score: 15 },
  { keyword: "a24", score: 15 },
  { keyword: "disney", score: 15 },
  { keyword: "warner bros", score: 15 },
  { keyword: "box office", score: 15 },
  { keyword: "release date", score: 15 },
  { keyword: "netflix", score: 10 },
  { keyword: "sequel", score: 10 },
  { keyword: "cannes", score: 10 },
  { keyword: "record", score: 10 },
  { keyword: "casting", score: 10 },
  { keyword: "cast", score: 10 },
];

const IMPORTANT_NEWS_THRESHOLD = 15;

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

  const isAllowed = ALLOWED_KEYWORDS.some((word) => textToCheck.includes(word));
  const isBlocked = BLOCKED_KEYWORDS.some((word) => textToCheck.includes(word));

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
          description: item.contentSnippet || item.summary || item.content || "",
          source: feed.name,
          url: item.link,
          image: extractImageFromRssItem(item),
          publishedAt: item.isoDate || item.pubDate,
          sourceType: "rss",
        });
      }

      console.log(`📡 RSS fetched: ${feed.name} — ${items.length} items`);
    } catch (err) {
      console.error(`⚠️ RSS failed: ${feed.name}`, err.message);
    }
  }

  return allArticles;
}

async function fetchNewsApiArticles() {
  try {
    if (!process.env.NEWS_API_KEY) {
      console.log("⚠️ NEWS_API_KEY missing. Skipping NewsAPI.");
      return [];
    }

    const newsRes = await axios.get("https://newsapi.org/v2/everything", {
      params: {
        q: `
          (movie OR movies OR cinema OR film OR trailer OR "box office" OR "film festival" OR director OR actor)
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

    console.log("📰 NewsAPI status:", newsRes.data.status);
    console.log("📰 NewsAPI articles found:", articles.length);

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
    console.error("⚠️ NewsAPI failed:", err.response?.data || err.message);
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

async function writeCaptions(article) {
  const prompt = `
You are the official social media writer for Scene, a modern movie social platform.

Your job is to turn real cinema/movie industry news into short social media posts.

Write 3 separate captions:
1. english
2. arabic
3. scene

Rules:
- Each caption under 35 words.
- No spoilers.
- No celebrity gossip.
- No personal-life news unless it directly affects a film/project.
- Only movie/cinema/film industry news.
- Sound exciting, clean, and modern.
- Arabic should sound natural Saudi/Gulf Arabic, not formal news Arabic.
- Do not invent facts.
- If the article is not truly movie/cinema news, return:
{
  "skip": true,
  "reason": "not cinema news"
}

Return ONLY valid JSON like this:
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
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
  });

  const rawText = response.choices[0]?.message?.content || "";

  try {
    return JSON.parse(rawText);
  } catch {
    return {
      english: rawText,
      arabic: rawText,
      scene: rawText,
    };
  }
}

async function generateSocialNews() {
  try {
    const rssArticles = await fetchRssArticles();
    const newsApiArticles = await fetchNewsApiArticles();

    const articles = dedupeArticles([...rssArticles, ...newsApiArticles])
      .filter((article) => article.title && article.url)
      .slice(0, 30);

    console.log("🎬 Total combined articles:", articles.length);
    console.log("🎬 First combined article:", articles[0]?.title);

    let created = 0;
    let skipped = 0;
    let lowImportanceSkipped = 0;
    let telegramSent = 0;

    for (const article of articles) {
      if (!isCinemaNews(article)) {
        skipped += 1;
        console.log("⏭️ Skipped non-cinema article:", article.title);
        continue;
      }

      const importance = scoreArticleImportance(article);

      if (importance.score < IMPORTANT_NEWS_THRESHOLD) {
        skipped += 1;
        lowImportanceSkipped += 1;
        console.log(
          `⏭️ Skipped low-importance article (${importance.score}):`,
          article.title
        );
        continue;
      }

      console.log(
        `🔥 Important article (${importance.score}) [${importance.matched.join(", ")}]:`,
        article.title
      );

      const hash = createHash(article);
      const exists = await SocialNewsDraft.findOne({ hash });

      if (exists) {
        skipped += 1;
        console.log("⏭️ Skipped duplicate article:", article.title);
        continue;
      }

      const captions = await writeCaptions(article);

      if (captions.skip) {
        skipped += 1;
        console.log("⏭️ AI skipped article:", article.title, captions.reason);
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
          console.log("⏭️ Duplicate hash race condition:", article.title);
          continue;
        }

        throw dbErr;
      }

      created += 1;
      console.log("🎬 Created draft:", article.title);

      try {
        await sendTelegramDraft(savedDraft);
        telegramSent += 1;
      } catch (telegramErr) {
        console.error(
          "❌ Telegram send failed:",
          telegramErr.response?.data || telegramErr.message
        );
      }
    }

    return {
      rssFound: rssArticles.length,
      newsApiFound: newsApiArticles.length,
      combinedFound: articles.length,
      draftsCreated: created,
      skipped,
      lowImportanceSkipped,
      telegramSent,
    };
  } catch (err) {
    console.error("❌ Social news error:", err.response?.data || err.message);
    throw err;
  }
}

module.exports = generateSocialNews;

