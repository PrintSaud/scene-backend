const axios = require("axios");

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function buildFullMessage(draft) {
  return `
🎬 Scene News Draft

📰 ${draft.title}

━━━━━━━━━━━━━━

🇺🇸 English:
${draft.captions?.english || ""}

━━━━━━━━━━━━━━

🇸🇦 Arabic:
${draft.captions?.arabic || ""}

━━━━━━━━━━━━━━

✨ Scene:
${draft.captions?.scene || ""}

━━━━━━━━━━━━━━

Source: ${draft.source || "Unknown"}
${draft.url ? `\nLink: ${draft.url}` : ""}
`;
}

function buildShortCaption(draft) {
  return `
🎬 Scene News Draft

📰 ${draft.title}

✨ Scene:
${draft.captions?.scene || ""}

Source: ${draft.source || "Unknown"}
`;
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

async function sendTelegramDraft(draft) {
  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      console.log("⚠️ Telegram env missing. Skipping Telegram send.");
      return;
    }

    const fullMessage = buildFullMessage(draft);
    const shortCaption = buildShortCaption(draft).slice(0, 950);

    if (draft.image) {
      try {
        await axios.post(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
          {
            chat_id: TELEGRAM_CHAT_ID,
            photo: draft.image,
            caption: shortCaption,
          }
        );

        await sendTextMessage(fullMessage);

        console.log("📨 Telegram photo draft sent");
        return;
      } catch (photoErr) {
        console.error(
          "⚠️ Telegram photo failed, falling back to text:",
          photoErr.response?.data || photoErr.message
        );
      }
    }

    await sendTextMessage(fullMessage);
    console.log("📨 Telegram text draft sent");
  } catch (err) {
    console.error("❌ Telegram error full:", JSON.stringify(err.response?.data || err.message, null, 2));
    throw err;
  }
}



module.exports = sendTelegramDraft;