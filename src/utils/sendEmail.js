// src/utils/sendEmail.js
const mailgun = require("mailgun-js");

// ⚡ Make sure these are set in your environment or .env
// MAILGUN_API_KEY = "your-mailgun-api-key"
// MAILGUN_DOMAIN = "your-mailgun-domain"

if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
  console.warn(
    "⚠️ Mailgun API key or domain missing. Set MAILGUN_API_KEY and MAILGUN_DOMAIN in your environment."
  );
}

const mg = mailgun({
  apiKey: process.env.MAILGUN_API_KEY,
  domain: process.env.MAILGUN_DOMAIN,
});

const sendEmail = async (to, subject, text) => {
  try {
    const data = {
      from: `Scene 🎬 <no-reply@${process.env.MAILGUN_DOMAIN}>`,
      to,
      subject,
      text,
    };

    const body = await mg.messages().send(data);
    console.log("📨 Verification email sent:", to, body.id);
    return body;
  } catch (err) {
    console.error("❌ Verification email failed:", err.message);
    return null;
  }




  
};

module.exports = sendEmail;
