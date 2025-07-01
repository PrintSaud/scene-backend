const express = require('express');
const router = express.Router();
const User = require('../models/user');
const jwt = require('jsonwebtoken'); // Move to the top
const protect = require('../middleware/authMiddleware');
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const crypto = require('crypto');

router.post('/register', async (req, res) => {
  const { username, email, password, avatar } = req.body; // ← avatar added

  try {
    if (existingUser)
      return res.status(400).json({ error: 'Email already in use' });

    const user = new User({ username, email, password, avatar }); // ← include avatar
    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        avatar: user.avatar, // ✅ include avatar in response
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// google path

// POST /api/auth/google
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

    // If new user, download avatar
    if (!user) {
      let avatarPath = "";
      const ext = picture.includes(".png") ? ".png" : ".jpg";
      const filename = `${uuidv4()}${ext}`;

      try {
        avatarPath = await saveImageFromUrl(picture, filename); // ✅ saved locally
      } catch (err) {
        console.error("❌ Failed to save Google avatar:", err.message);
        avatarPath = ""; // fallback
      }

      const username = name.replace(/\s+/g, '').toLowerCase();

      user = await User.create({
        googleId,
        email,
        username,
        avatar: avatarPath, // ✅ correct place now
        password: 'google-oauth', // dummy
      });

      console.log("🆕 New Google user created:", username);
    } else {
      console.log("✅ Existing user logged in:", user.username);
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: '7d',
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


// ✅ Login User (now correctly placed outside register)
// GET profile (Protected)
router.get('/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT profile update (Protected)
router.put('/profile', protect, async (req, res) => {
  const { username, email, password, bio, avatar } = req.body;

  try {
    const user = await User.findById(req.user._id);

    if (!user) return res.status(404).json({ error: 'User not found' });

    if (username) user.username = username;
    if (email) user.email = email;
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

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isMatch = await user.matchPassword(password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid password' });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: '1h',
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

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'Email not found' });

    // Generate 6-digit code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 mins from now

    user.resetCode = resetCode;
    user.resetCodeExpires = expires;
    await user.save();

    // Simulate sending email
    console.log(`📧 Reset code for ${email}: ${resetCode}`);

    res.status(200).json({ message: 'Reset code sent to email' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/verify-reset-code

router.post('/verify-reset-code', async (req, res) => {
  const { email, code } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user || !user.resetCode) {
      return res.status(400).json({ error: 'Invalid reset attempt' });
    }

    if (user.resetCode !== code) {
      return res.status(401).json({ error: 'Incorrect reset code' });
    }

    if (Date.now() > new Date(user.resetCodeExpires)) {
      return res.status(410).json({ error: 'Reset code has expired' });
    }

    res.status(200).json({ message: 'Code verified successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.resetCode !== code || new Date() > user.resetCodeExpires) {
      return res.status(401).json({ error: 'Invalid or expired reset code' });
    }

    user.password = newPassword;
    user.resetCode = undefined;
    user.resetCodeExpires = undefined;

    await user.save();

    res.status(200).json({ message: 'Password reset successful' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});


// Test Route
router.get('/ping', (req, res) => {
  res.send('Auth route is working!');
});

console.log('✅ auth.js is loaded');

module.exports = router;

