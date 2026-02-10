// src/utils/sendEmail.js
const mailgun = require("mailgun-js");

const mg = mailgun({
  apiKey: process.env.MAILGUN_API_KEY,
  domain: process.env.MAILGUN_DOMAIN,
  host: "api.eu.mailgun.net",
});

const sendEmail = async (to, subject, text) => {
  const data = {
    from: `Scene <${process.env.MAILGUN_FROM}>`,
    to,
    subject,
    text,
  };

  const body = await mg.messages().send(data);
  console.log("📨 Mailgun accepted message:", body.id);
  return body;
};

module.exports = sendEmail;
