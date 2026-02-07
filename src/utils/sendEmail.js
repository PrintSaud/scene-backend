const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: process.env.EMAIL_USER,   // your Gmail address
    pass: process.env.EMAIL_PASS,   // your Gmail app password
  },
});

const sendEmail = async (to, subject, text) => {
  const mailOptions = {
    from: `"Scene 🎬" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text,
  };

  try {
    const info = await transporter.sendMail(mailOptions);

    // ✅ Log success
    console.log("📨 Verification email sent:", {
      to,
      subject,
      messageId: info.messageId,
    });

    return info;
  } catch (err) {
    // ❌ Log failure but do NOT crash signup
    console.error("❌ Verification email failed:", err.message);
    return null;
  }
};

module.exports = sendEmail;
