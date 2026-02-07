const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "Gmail", // works better in cloud envs
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  connectionTimeout: 5000, // 5s max
  greetingTimeout: 5000,
  socketTimeout: 5000,
});

const sendEmail = async (to, subject, text) => {
  try {
    const info = await transporter.sendMail({
      from: `"Scene 🎬" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text,
    });
    console.log("📨 Verification email sent:", to, info.messageId);
    return info;
  } catch (err) {
    console.error("❌ Verification email failed:", err.message);
    return null;
  }
};

module.exports = sendEmail;
