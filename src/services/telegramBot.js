
const axios = require("axios");

function clean(value) {
  return String(value ?? "").trim();
}

function buildOrganizationMessage(org) {
  return [
    "🏢 NEW SCENE ORGANIZATION APPLICATION",
    "",
    "━━━━━━━━━━━━━━",
    "",
    `🏷 Organization: ${clean(org.name)}`,
    `👤 Username: @${clean(org.username)}`,
    `📧 Email: ${clean(org.email)}`,
    "",
    "📝 Biography:",
    clean(org.bio) || "Not provided",
    "",
    `📎 Company Document: ${
      clean(org.documentUrl) || "Not provided"
    }`,
    "",
    `🆔 Application ID: ${clean(org._id)}`,
    "⏳ Status: Pending Review",
    "",
    "━━━━━━━━━━━━━━",
    "💜 Scene Organizations",
  ].join("\n");
}

async function sendOrganizationApplication(org) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new Error("Telegram credentials not configured");
  }

  const message = buildOrganizationMessage(org);

  // Telegram text messages have a 4096-character limit.
  const response = await axios.post(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      chat_id: chatId,
      text: message.slice(0, 4000),
      disable_web_page_preview: true,
    },
    { timeout: 10000 }
  );

  if (!response.data?.ok) {
    throw new Error("Telegram rejected the message");
  }

  return response.data;
}

module.exports = {
  sendOrganizationApplication,
};
