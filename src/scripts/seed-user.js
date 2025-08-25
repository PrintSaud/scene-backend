// scripts/seed-user.js
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

// adjust if your model path differs
const User = require(path.join(__dirname, '..', 'models', 'user'));

(async () => {
  try {
    const uri = process.env.DB_URI || 'mongodb://127.0.0.1:27017/scene';
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, family: 4 });
    console.log('✅ Connected to Mongo');

    const email = 'sasbroishot@gmail.com';       // <-- change
    const username = 'Saud';                // <-- change
    const password = 'SAUD77Saud';        // <-- change

    // If your schema stores lowercase usernames/emails, do that here too
    const existing = await User.findOne({ email: email.toLowerCase() }).select('_id');
    if (existing) {
      console.log('ℹ️ User already exists:', existing._id.toString());
      process.exit(0);
    }

    const user = new User({
      name: 'Dev User',
      username,
      email: email.toLowerCase(),
      password,                // pre-save hook should hash this
      emailVerified: true,     // optional: skip verification in dev
    });

    await user.save();
    console.log('🎉 Seeded user:', { id: user._id.toString(), email, username });
    process.exit(0);
  } catch (e) {
    console.error('💥 Seed failed:', e.message);
    process.exit(1);
  }
})();
