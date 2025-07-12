const express = require('express');
const router = express.Router();
const User = require('../models/user');
const jwt = require('jsonwebtoken');
const protect = require('../middleware/authMiddleware');
const { OAuth2Client } = require('google-auth-library');
const { v4: uuidv4 } = require('uuid');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const crypto = require('crypto');
const saveImageFromUrl = require('../utils/saveImageFromUrl');

// 📥 Register
router.post('/register', async (req, res) => {
  try {
    let { name, username, email, password, avatar } = req.body;

    username = username.trim().toLowerCase();
    email = email.trim().toLowerCase();

    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ error: 'Email already in use' });

    const existingUsername = await User.findOne({
      username: { $regex: `^${username}$`, $options: "i" }
    });
    if (existingUsername)
      return res.status(400).json({ error: 'Username already taken' });

    const user = new User({ name, username, email, password, avatar });
    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: '30d',
    });
    

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        _id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
      }
    });
  } catch (error) {
    console.error('❌ Register Error:', error);
    res.status(500).json({ error: error.message });
  }
});


// 🧠 Google OAuth
router.post('/google', async (req, res) => {
  const { credential } = req.body;

  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    let user = await User.findOne({ email });

    if (!user) {
      let avatarPath = '';
      const ext = picture.includes('.png') ? '.png' : '.jpg';
      const filename = `${uuidv4()}${ext}`;

      try {
        avatarPath = await saveImageFromUrl(picture, filename);
      } catch (err) {
        console.error('❌ Failed to save Google avatar:', err.message);
        avatarPath = '';
      }

      const username = name.toLowerCase().replace(/\s+/g, '');

      user = await User.create({
        googleId,
        email: email.toLowerCase(),
        username,
        avatar: avatarPath,
        password: 'google-oauth',
      });

      console.log('🆕 New Google user created:', username);
    } else {
      console.log('✅ Existing user logged in:', user.username);
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: '30d',
    });
    

    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
      },
    });
  } catch (err) {
    console.error('❌ Google token verification failed:', err);
    res.status(401).json({ error: 'Invalid token' });
  }
});

// 🔐 Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isMatch = await user.matchPassword(password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid password' });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: '30d',
    });
    

    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🧾 Profile
router.get('/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ✏️ Update Profile
router.put('/profile', protect, async (req, res) => {
  const { username, email, password, bio, avatar } = req.body;

  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (username) user.username = username.toLowerCase().trim();
    if (email) user.email = email.toLowerCase().trim();
    if (password) user.password = password;
    if (bio) user.bio = bio;
    if (avatar) user.avatar = avatar;

    await user.save();

    res.status(200).json({
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        bio: user.bio,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🔐 Forgot Password Flow
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'Email not found' });

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000);

    user.resetCode = resetCode;
    user.resetCodeExpires = expires;
    await user.save();

    console.log(`📧 Reset code for ${email}: ${resetCode}`);
    res.status(200).json({ message: 'Reset code sent to email' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/verify-reset-code', async (req, res) => {
  const { email, code } = req.body;

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !user.resetCode)
      return res.status(400).json({ error: 'Invalid reset attempt' });

    if (user.resetCode !== code)
      return res.status(401).json({ error: 'Incorrect reset code' });

    if (Date.now() > new Date(user.resetCodeExpires))
      return res.status(410).json({ error: 'Reset code has expired' });

    res.status(200).json({ message: 'Code verified successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.resetCode !== code || new Date() > user.resetCodeExpires)
      return res.status(401).json({ error: 'Invalid or expired reset code' });

    user.password = newPassword;
    user.resetCode = undefined;
    user.resetCodeExpires = undefined;

    await user.save();

    res.status(200).json({ message: 'Password reset successful' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔍 Username + Email Availability Checks
router.get('/check-username', async (req, res) => {
  const username = req.query.username?.trim();
  if (!username || !/^[a-z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ available: false });
  }

  const exists = await User.findOne({
    username: { $regex: `^${username}$`, $options: 'i' }
  });

  res.json({ available: !exists });
});

router.get('/check-email', async (req, res) => {
  const email = req.query.email?.toLowerCase().trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({ available: false });
  }

  const exists = await User.findOne({ email });
  res.json({ available: !exists });
});

// 🔁 Ping
router.get('/ping', (req, res) => {
  res.send('Auth route is working!');
});

console.log('✅ auth.js is loaded');
module.exports = router;
