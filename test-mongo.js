// test-mongo.js
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  try {
    console.log('🔌 Connecting with URI:', process.env.DB_URI);
    await mongoose.connect(process.env.DB_URI, {
      serverSelectionTimeoutMS: 10000,
      family: 4,
    });
    console.log('✅ Connected successfully');
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to connect:', err.message);
    process.exit(1);
  }
})();
