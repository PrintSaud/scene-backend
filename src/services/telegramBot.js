const axios = require("axios");

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const DEBUG_TELEGRAM = process.env.TELEGRAM_DEBUG === "true";

function debugLog(...args) {
  if (DEBUG_TELEGRAM) console.log(...args);
}

function warnLog(...args) {
  console.warn(...args);
}

function errorLog(...args) {
  console.error(...args);
}

function clean(value) {
  return String(value || "").trim();
}

function buildFullMessage(draft) {
  const title = clean(draft.title);
  const english = clean(draft.captions?.english);
  const arabic = clean(draft.captions?.arabic);
  const scene = clean(draft.captions?.scene);
  const source = clean(draft.source) || "Unknown";
  const url = clean(draft.url);

  return `
🎬 Scene News Draft

📰 ${title}

━━━━━━━━━━━━━━

✨ نسخة Scene:
${scene}

━━━━━━━━━━━━━━

🇸🇦 النسخة العربية:
${arabic}

━━━━━━━━━━━━━━

🇺🇸 English:
${english}

━━━━━━━━━━━━━━

Source: ${source}
${url ? `\nLink: ${url}` : ""}
`.trim();
}

function buildShortCaption(draft) {
  const title = clean(draft.title);
  const scene = clean(draft.captions?.scene);
  const source = clean(draft.source) || "Unknown";

  return `
🎬 Scene News Draft

📰 ${title}

✨ نسخة Scene:
${scene}

Source: ${source}
`.trim();
}

async function sendTextMessage(message) {
  return axios.post(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      disable_web_page_preview: false,
    }
  );
}

async function sendPhotoMessage(imageUrl, caption) {
  return axios.post(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
    {
      chat_id: TELEGRAM_CHAT_ID,
      photo: imageUrl,
      caption,
    }
  );
}

async function sendTelegramDraft(draft) {
  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      debugLog("Telegram env missing. Skipping Telegram send.");
      return;
    }

    const fullMessage = buildFullMessage(draft);
    const shortCaption = buildShortCaption(draft).slice(0, 950);

    if (draft.image) {
      try {
        await sendPhotoMessage(draft.image, shortCaption);
        await sendTextMessage(fullMessage);

        debugLog("Telegram photo draft sent");
        return;
      } catch (photoErr) {
        warnLog(
          "Telegram photo failed, falling back to text:",
          photoErr.response?.data || photoErr.message
        );
      }
    }

    await sendTextMessage(fullMessage);
    debugLog("Telegram text draft sent");
  } catch (err) {
    errorLog(
      "Telegram error:",
      err.response?.data || err.message
    );

    throw err;
  }
}

module.exports = sendTelegramDraft;

