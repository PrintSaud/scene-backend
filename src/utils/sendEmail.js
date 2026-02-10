// src/utils/sendEmail.js
const mailgun = require("mailgun-js");

const mg = mailgun({
  apiKey: process.env.MAILGUN_API_KEY,
  domain: process.env.MAILGUN_DOMAIN,
  host: "api.eu.mailgun.net", // 🔥 THIS IS THE FIX
});

const sendEmail = async (to, subject, text) => {
  const data = {
    from: `Scene 🎬 <no-reply@${process.env.MAILGUN_DOMAIN}>`,
    to,
    subject,
    text,
  };

  // ❗ DO NOT swallow errors
  const body = await mg.messages().send(data);
  console.log("📨 Verification email sent:", to, body.id);
  return body;
};

module.exports = sendEmail;
