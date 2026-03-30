// src/utils/sendEmail.js
const mailgun = require("mailgun-js");

// Confirm env vars at startup
console.log("⚡ MAILGUN_API_KEY exists:", !!process.env.MAILGUN_API_KEY);
console.log("⚡ MAILGUN_DOMAIN:", process.env.MAILGUN_DOMAIN);
console.log("⚡ MAILGUN_FROM:", process.env.MAILGUN_FROM);

const mg = mailgun({
  apiKey: process.env.MAILGUN_API_KEY,
  domain: process.env.MAILGUN_DOMAIN,
  host: "api.eu.mailgun.net", // must match your EU domain
});

const sendEmail = async (to, subject, text) => {
 // console.log("🔹 Preparing to send email");
 // console.log("   To:", to);
 // console.log("   Subject:", subject);
 // console.log("   From:", `Scene <${process.env.MAILGUN_FROM}>`);
 // console.log("   Domain used:", process.env.MAILGUN_DOMAIN);

  const data = {
    from: `Scene <${process.env.MAILGUN_FROM}>`,
    to,
    subject,
    text,
  };

  try {
    const body = await mg.messages().send(data);
    console.log("📨 Mailgun accepted message:", body.id);
   // console.log("   Full response:", body);
    return body;
  } catch (err) {
    console.error("❌ Mailgun send FAILED!");
    console.error("   Error message:", err.message);
    console.error("   Error object:", err);
    console.error("   Attempted to send to:", to);
   // console.error("   Using domain:", process.env.MAILGUN_DOMAIN);
    throw err; // throw so caller knows it failed
  }
};

module.exports = sendEmail;
