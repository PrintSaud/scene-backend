const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, // true for 465
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false, // allows connection in server envs
  },
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
