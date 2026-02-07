const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
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
