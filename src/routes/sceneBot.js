const express = require("express");
const crypto = require("crypto");
const dayjs = require("dayjs");

const protect = require("../middleware/authMiddleware");
const openai = require("../utils/openai");
const SceneBotUsage = require(
  "../models/sceneBotUsage"
);

const router = express.Router();

const SCENEBOT_MODEL =
  process.env.SCENEBOT_MODEL || "gpt-4o";

const DAILY_LIMIT = Math.max(
  1,
  Number(
    process.env.SCENEBOT_DAILY_LIMIT || 20
  )
);

const MAX_MESSAGE_LENGTH = 3000;
const MAX_HISTORY_MESSAGES = 8;
const CONVERSATION_TTL_MS =
  6 * 60 * 60 * 1000;

const ALLOWED_LANGUAGES = new Set([
  "english",
  "arabic",
  "french",
]);

/*
 * Temporary in-memory conversation state.
 *
 * Railway restarts may clear this, which is
 * acceptable. Permanent conversation storage
 * can be added later with a dedicated model.
 */
const conversationMap = new Map();

// ============================================================
// HELPERS
// ============================================================

const cleanString = (
  value,
  maximumLength
) => {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .slice(0, maximumLength);
};

const normalizeLanguage = (value) => {
  const language = cleanString(
    value,
    20
  ).toLowerCase();

  const aliases = {
    en: "english",
    english: "english",

    ar: "arabic",
    arabic: "arabic",
    عربي: "arabic",
    العربية: "arabic",

    fr: "french",
    french: "french",
    français: "french",
  };

  const normalized =
    aliases[language] || "english";

  return ALLOWED_LANGUAGES.has(
    normalized
  )
    ? normalized
    : "english";
};

const detectLanguageCommand = (
  message,
  suppliedLanguage
) => {
  const lowerMessage =
    message.toLowerCase();

  if (
    lowerMessage.includes(
      "reply in arabic"
    ) ||
    lowerMessage.includes(
      "respond in arabic"
    )
  ) {
    return "arabic";
  }

  if (
    lowerMessage.includes(
      "reply in french"
    ) ||
    lowerMessage.includes(
      "respond in french"
    )
  ) {
    return "french";
  }

  if (
    lowerMessage.includes(
      "reply in english"
    ) ||
    lowerMessage.includes(
      "respond in english"
    )
  ) {
    return "english";
  }

  return normalizeLanguage(
    suppliedLanguage
  );
};

const safeSecretMatch = (
  suppliedSecret,
  configuredSecret
) => {
  if (
    !suppliedSecret ||
    !configuredSecret
  ) {
    return false;
  }

  const suppliedBuffer =
    Buffer.from(String(suppliedSecret));

  const configuredBuffer =
    Buffer.from(String(configuredSecret));

  if (
    suppliedBuffer.length !==
    configuredBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    suppliedBuffer,
    configuredBuffer
  );
};

const createReviewUserKey = (req) => {
  const source = [
    req.ip || "",
    req.get("user-agent") || "",
  ].join("|");

  return crypto
    .createHash("sha256")
    .update(source)
    .digest("hex")
    .slice(0, 24);
};

const getConversationKey = (req) => {
  if (req.sceneBotReviewBypass) {
    return `review:${createReviewUserKey(
      req
    )}`;
  }

  return `user:${String(
    req.user._id
  )}`;
};

const getSystemPrompt = (language) => {
  return [
    "You are SceneBot, the film expert inside Scene.",
    `Respond fluently in ${language}.`,
    "Be friendly, conversational, creative, and direct.",
    "Focus on movies, filmmaking, actors, directors, recommendations, trivia, reviews, and cinema-related topics.",
    "When a request is unrelated to cinema, briefly redirect the conversation toward movies or television.",
    "Do not claim to be human.",
    "Do not fabricate movie releases, credits, quotes, ratings, or other facts.",
    "When unsure about a fact, clearly communicate uncertainty.",
    "Keep answers useful and reasonably concise unless the user requests detail.",
  ].join("\n");
};

const getConversation = (
  conversationKey,
  language
) => {
  const existing =
    conversationMap.get(
      conversationKey
    );

  const now = Date.now();

  if (
    !existing ||
    now - existing.updatedAt >
      CONVERSATION_TTL_MS
  ) {
    const freshConversation = {
      language,
      updatedAt: now,
      messages: [],
    };

    conversationMap.set(
      conversationKey,
      freshConversation
    );

    return freshConversation;
  }

  /*
   * Changing the requested language updates
   * the system prompt on the next request.
   */
  existing.language = language;
  existing.updatedAt = now;

  return existing;
};

const cleanOldConversations = () => {
  const expiration =
    Date.now() -
    CONVERSATION_TTL_MS;

  for (
    const [
      key,
      conversation,
    ] of conversationMap.entries()
  ) {
    if (
      conversation.updatedAt <
      expiration
    ) {
      conversationMap.delete(key);
    }
  }
};

const reserveDailyUsage = async (
  userId
) => {
  const date = dayjs().format(
    "YYYY-MM-DD"
  );

  /*
   * Ensure today's usage document exists.
   */
  await SceneBotUsage.updateOne(
    {
      userId,
      date,
    },
    {
      $setOnInsert: {
        userId,
        date,
        count: 0,
      },
    },
    {
      upsert: true,
    }
  );

  /*
   * Atomic reservation prevents simultaneous
   * requests from bypassing the daily limit.
   */
  const usage =
    await SceneBotUsage.findOneAndUpdate(
      {
        userId,
        date,
        count: {
          $lt: DAILY_LIMIT,
        },
      },
      {
        $inc: {
          count: 1,
        },
      },
      {
        new: true,
      }
    );

  if (!usage) {
    return {
      allowed: false,
      date,
      remaining: 0,
    };
  }

  return {
    allowed: true,
    date,
    remaining: Math.max(
      0,
      DAILY_LIMIT - usage.count
    ),
  };
};

const releaseDailyUsage = async (
  userId,
  date
) => {
  try {
    await SceneBotUsage.updateOne(
      {
        userId,
        date,
        count: {
          $gt: 0,
        },
      },
      {
        $inc: {
          count: -1,
        },
      }
    );
  } catch (error) {
    console.warn(
      "⚠️ Failed to release SceneBot usage:",
      error.message
    );
  }
};

// ============================================================
// AUTHENTICATION
// ============================================================

const sceneBotAuth = (
  req,
  res,
  next
) => {
  const suppliedReviewSecret =
    req.get(
      "x-scenebot-review-secret"
    );

  const configuredReviewSecret =
    process.env
      .SCENEBOT_REVIEW_SECRET;

  /*
   * An App Review bypass is allowed only when
   * an explicit server-side secret is set and
   * the request supplies the exact secret.
   *
   * Origin headers are never trusted.
   */
  if (
    safeSecretMatch(
      suppliedReviewSecret,
      configuredReviewSecret
    )
  ) {
    req.sceneBotReviewBypass = true;

    req.user = {
      _id: createReviewUserKey(req),
      username: "Scene Review",
    };

    return next();
  }

  return protect(req, res, next);
};

// ============================================================
// SCENEBOT
// ============================================================

// POST /api/scene-bot
router.post(
  "/",
  sceneBotAuth,
  async (req, res) => {
    const rawMessage =
      req.body?.message;

    if (
      typeof rawMessage !== "string"
    ) {
      return res.status(400).json({
        message:
          "You must enter a valid message.",
      });
    }

    const message = cleanString(
      rawMessage,
      MAX_MESSAGE_LENGTH
    );

    if (!message) {
      return res.status(400).json({
        message:
          "❗ You must enter a message.",
      });
    }

    if (
      rawMessage.length >
      MAX_MESSAGE_LENGTH
    ) {
      return res.status(413).json({
        message:
          `Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer.`,
      });
    }

    let usageReservation = null;

    try {
      /*
       * Real users are usage-limited.
       * The explicit App Review bypass is not.
       */
      if (
        !req.sceneBotReviewBypass
      ) {
        usageReservation =
          await reserveDailyUsage(
            req.user._id
          );

        if (
          !usageReservation.allowed
        ) {
          return res.status(429).json({
            message:
              "You have reached today's SceneBot limit. Try again tomorrow.",

            dailyLimit:
              DAILY_LIMIT,

            remaining: 0,
          });
        }
      }

      const language =
        detectLanguageCommand(
          message,
          req.body?.lang
        );

      cleanOldConversations();

      const conversationKey =
        getConversationKey(req);

      const conversation =
        getConversation(
          conversationKey,
          language
        );

      conversation.messages.push({
        role: "user",
        content: message,
      });

      /*
       * Preserve only the latest conversation
       * messages to prevent token growth.
       */
      conversation.messages =
        conversation.messages.slice(
          -MAX_HISTORY_MESSAGES
        );

      const completion =
        await openai.chat.completions.create(
          {
            model: SCENEBOT_MODEL,

            messages: [
              {
                role: "system",
                content:
                  getSystemPrompt(
                    language
                  ),
              },

              ...conversation.messages,
            ],

            temperature: 0.8,
            max_tokens: 800,
          },
          {
            timeout: 30000,
          }
        );

      const rawReply =
        completion.choices?.[0]
          ?.message?.content;

      const reply =
        typeof rawReply === "string"
          ? rawReply.trim()
          : "";

      if (!reply) {
        throw new Error(
          "SceneBot returned an empty response"
        );
      }

      conversation.messages.push({
        role: "assistant",
        content: reply,
      });

      conversation.messages =
        conversation.messages.slice(
          -MAX_HISTORY_MESSAGES
        );

      conversation.updatedAt =
        Date.now();

      return res.json({
        reply,

        remaining:
          req.sceneBotReviewBypass
            ? null
            : usageReservation
                ?.remaining ?? null,
      });
    } catch (error) {
      /*
       * A failed OpenAI request should not use
       * one of the user's daily messages.
       */
      if (
        usageReservation?.allowed &&
        !req.sceneBotReviewBypass
      ) {
        await releaseDailyUsage(
          req.user._id,
          usageReservation.date
        );
      }

      console.error(
        "❌ SceneBot request failed:",
        {
          message: error.message,
          status: error.status,
          code: error.code,
        }
      );

      if (
        error.code ===
          "ETIMEDOUT" ||
        error.code ===
          "ECONNABORTED"
      ) {
        return res.status(504).json({
          message:
            "SceneBot took too long to respond. Please try again.",
        });
      }

      if (
        error.status === 429
      ) {
        return res.status(503).json({
          message:
            "SceneBot is busy right now. Please try again shortly.",
        });
      }

      return res.status(500).json({
        message:
          "SceneBot is temporarily unavailable. Please try again later.",
      });
    }
  }
);

// ============================================================
// CONVERSATION RESET
// ============================================================

// DELETE /api/scene-bot/conversation
router.delete(
  "/conversation",
  sceneBotAuth,
  async (req, res) => {
    const conversationKey =
      getConversationKey(req);

    const deleted =
      conversationMap.delete(
        conversationKey
      );

    return res.json({
      cleared: deleted,
    });
  }
);

// ============================================================
// HEALTH
// ============================================================

// GET /api/scene-bot/health
router.get(
  "/health",
  (req, res) => {
    return res.json({
      status: "ok",
      configured:
        Boolean(
          process.env.OPENAI_API_KEY
        ),
    });
  }
);

module.exports = router;