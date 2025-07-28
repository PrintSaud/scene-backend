const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: process.env.EMAIL_USER,      // your Gmail address
    pass: process.env.EMAIL_PASS,      // your Gmail app password
  },
});

const sendEmail = async (to, subject, text) => {
  const mailOptions = {
    from: `"Scene 🎬" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text,
  };

  await transporter.sendMail(mailOptions);
};

module.exports = sendEmail;
