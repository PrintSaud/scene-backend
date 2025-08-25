// src/scripts/reset-password.js
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/user");

(async () => {
  try {
    console.log("🔌 Connecting to Mongo...");
    await mongoose.connect(process.env.DB_URI, {
      serverSelectionTimeoutMS: 20000,
    });

    const email = "sasbroishot@gmail.com";
    const newPassword = "Scene123!"; // 🔑 temp password

    console.log("🔄 Resetting password for:", email);
    const hashed = await bcrypt.hash(newPassword, 10);

    const user = await User.findOneAndUpdate(
      { email },
      { password: hashed },
      { new: true }
    );

    if (!user) {
      console.log("❌ User not found in DB");
    } else {
      console.log("✅ Password reset successful");
      console.log("👉 Use this to login now:");
      console.log("Email:", email);
      console.log("Password:", newPassword);
    }

    await mongoose.disconnect();
    console.log("🔌 Disconnected");
  } catch (err) {
    console.error("💥 Error during reset:", err);
    process.exit(1);
  }
})();
