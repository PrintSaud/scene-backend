const express = require("express");
const crypto = require("crypto");
const dayjs = require("dayjs");

const protect = require("../middleware/authMiddleware");
const openai = require("../utils/openai");
const SceneBotUsage = require(
  "../models/sceneBotUsage"
);

const router = express.Router();

/*
 * GPT-5.6 Terra is the balanced default for SceneBot:
 * strong entertainment reasoning without using the
 * highest-cost model for every chat.
 *
 * Railway can override this with SCENEBOT_MODEL.
 */
const SCENEBOT_MODEL =
  process.env.SCENEBOT_MODEL ||
  "gpt-5.6-terra";

const DAILY_LIMIT = Math.max(
  1,
  Number(
    process.env.SCENEBOT_DAILY_LIMIT || 50
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
const stripSceneBotReply = (
  value
) => {
  if (typeof value !== "string") {
    return "";
  }

  return value
    /*
     * Convert markdown links:
     * [title](https://example.com) -> title
     */
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi,
      "$1"
    )

    /*
     * Remove remaining raw URLs.
     */
    .replace(
      /https?:\/\/[^\s)]+/gi,
      ""
    )

    /*
     * Remove common bare domains that look like sources.
     */
    .replace(
      /\b(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?/gi,
      ""
    )

    /*
     * Remove markdown emphasis and code styling.
     */
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")

    /*
     * Remove leftover empty brackets / parens from source formatting.
     */
    .replace(/\[\s*\]/g, "")
    .replace(/\(\s*\)/g, "")

    /*
     * Clean spacing.
     */
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
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

const getSceneCurrentDate = () => {
  /*
   * Scene is based in Saudi Arabia, so use Riyadh
   * time instead of Railway/UTC for "today".
   */
  return new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone:
        "Asia/Riyadh",

      year:
        "numeric",

      month:
        "long",

      day:
        "numeric",
    }
  ).format(
    new Date()
  );
};

const getSystemPrompt = (language) => {
  const currentDate =
    getSceneCurrentDate();

  return [
    "You are SceneBot, the movie and television expert inside Scene.",

    `The current date is ${currentDate}.`,

    `Respond fluently in ${language}.`,

    "Be friendly, conversational, creative, confident, and direct.",

    "Focus equally on movies and television shows.",

    "You can discuss movies, TV shows, actors, directors, writers, cinematographers, characters, franchises, universes, recommendations, trivia, reviews, filmmaking, television production, release schedules, box office, casting, and entertainment news.",

    "",

    "CURRENT INFORMATION RULES:",

    "You have access to web search.",

    "Use web search whenever the answer depends on information that may have changed, including current or upcoming releases, release dates, current franchise order, casting changes, announcements, cancellations, renewals, box office results, awards, production status, trailers, recent episodes, current streaming availability, or entertainment news.",

    "Also search when the user uses words such as latest, current, today, now, upcoming, next, recently, announced, released, coming soon, or newest.",

    "If there is a meaningful chance that your stored knowledge is outdated, search before answering.",

    "Do not call a movie, season, episode, or project 'upcoming' without checking whether its release date is still in the future relative to the current date.",

    "Never rely on an old announced release schedule when a newer release, delay, cancellation, or announcement may exist.",

    "When discussing a franchise timeline such as Marvel, DC, Star Wars, or another active universe, verify current status if the question involves what comes next or what has recently released.",

    "For stable questions such as themes, opinions, filmmaking analysis, older movie recommendations, character analysis, or historical facts that are unlikely to have changed, you do not need to search unnecessarily.",

    "",

    "ACCURACY:",

    "Prefer verified current information over assumptions.",

    "Do not fabricate releases, credits, quotes, ratings, episode details, release dates, announcements, or other facts.",

    "If reliable sources conflict, briefly acknowledge the uncertainty.",

    "Never present rumors as confirmed facts.",

    "",

    "MOVIE / TV CONTEXT:",

    "Pay close attention to whether the user is discussing a movie or a TV show.",

    "Never assume that a title refers to a movie when it may refer to a television show.",

    "When a movie and a TV show share the same or a similar title, use the conversation context and ask for clarification only when genuinely necessary.",

    "",

    "SPOILERS:",

    "If the user requests a spoiler-free answer, do not reveal major twists, deaths, endings, identities, or later-story developments.",

    "Do not introduce spoilers unless the user clearly asks for them.",

    "",

    "STYLE:",

    "Do not claim to be human.",

    "Keep answers useful and reasonably concise unless the user requests more detail.",

    "Do not include raw URLs, markdown links, source attributions, or tracking parameters in replies.",
    "Prefer clean plain-text answers with no markdown formatting unless the user explicitly asks for markdown.",

    "If web search was useful, naturally incorporate the verified information rather than talking about the search process.",

    "When a request is unrelated to movies or television, briefly redirect the conversation toward entertainment topics supported by Scene.",
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

      /*
       * Responses API gives SceneBot access to
       * OpenAI's hosted live web-search tool.
       *
       * tool_choice "auto" means the model can
       * answer stable questions immediately and
       * search only when current information is
       * useful.
       */
      const response =
        await openai.responses.create(
          {
            model:
              SCENEBOT_MODEL,

            instructions:
              getSystemPrompt(
                language
              ),

            input:
              conversation.messages,

            tools: [
              {
                type:
                  "web_search",
              },
            ],

            tool_choice:
              "auto",

            /*
             * Low reasoning keeps ordinary chat
             * responsive while still allowing
             * stronger reasoning when necessary.
             */
            reasoning: {
              effort:
                "low",
            },

            max_output_tokens:
              5000,
          },
          {
            /*
             * Live search may take slightly longer
             * than a normal model-only response.
             */
            timeout:
              90000,
          }
        );

      const rawReply =
        response?.output_text;

      const reply =
        stripSceneBotReply(
          typeof rawReply === "string"
            ? rawReply
            : ""
        );

      if (!reply) {
        throw new Error(
          "SceneBot Responses API returned an empty response"
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
          "ECONNABORTED" ||
        error.code ===
          "TIMEOUT" ||
        error.name ===
          "AbortError"
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

        /*
         * Temporary SceneBot diagnostics.
         * Remove after the OpenAI Responses API
         * integration is confirmed working.
         */
        debug:
          process.env.NODE_ENV === "production"
            ? {
                message:
                  error?.message || null,

                status:
                  error?.status || null,

                code:
                  error?.code || null,

                type:
                  error?.type || null,

                param:
                  error?.param || null,
              }
            : {
                message:
                  error?.message || null,

                status:
                  error?.status || null,

                code:
                  error?.code || null,

                type:
                  error?.type || null,

                param:
                  error?.param || null,

                stack:
                  error?.stack || null,
              },
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