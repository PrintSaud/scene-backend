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
const sendEmail = require("../utils/sendEmail");
const validateEmailDeliverability = require('../utils/validateEmailDeliverability');
const Log = require('../models/log');
const CustomPoster = require('../models/customPoster');
const Notification = require('../models/notification');

router.post('/validate-email', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ ok: false, reason: 'missing_email' });

    const check = await validateEmailDeliverability(email);
    return res.json({
      ok: !!check.ok,
      reason: check.reason || 'unknown',
      didYouMean: check.didYouMean,
      email: check.email,
    });
  } catch {
    return res.json({ ok: false, reason: 'validator_error' });
  }
});



router.post('/register', async (req, res) => {
  try {
    let { name, username, email, password, avatar } = req.body;

    username = (username || '').trim();
    email = (email || '').trim().toLowerCase();

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // ⚠️ Deliverability check — DO NOT BLOCK signup
    try {
      const check = await validateEmailDeliverability(email);
      if (!check.ok) {
        console.warn('⚠️ Email deliverability warning:', email, check.reason);
      }
    } catch (err) {
      console.warn('⚠️ Email deliverability check failed:', err.message);
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'Email already in use' });

    const existingUsername = await User.findOne({
      username: { $regex: `^${username}$`, $options: "i" }
    });
    if (existingUsername) return res.status(400).json({ error: 'Username already taken' });

    const verificationCode = crypto.randomInt(100000, 999999).toString();

    const user = new User({
      name,
      username,
      email,
      password,
      avatar,
      verificationCode,
      verificationCodeExpires: new Date(Date.now() + 10 * 60 * 1000),
      emailVerified: false,
    });

    await user.save();

    // 🚀 Fire-and-forget email (CRITICAL)
    sendEmail(
      email,
      "Your Scene verification code",
      `Welcome to Scene! 🎬\n\nYour verification code:\n\n${verificationCode}\n\nIt expires in 10 minutes.`
    ).catch(err => {
      console.error('❌ Verification email failed:', err.message);
    });

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '90d' }
    );

    return res.status(201).json({
      message: 'User registered successfully.',
      token,
      user: {
        _id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        emailVerified: false,
      }
    });
  } catch (error) {
    console.error('❌ Register Error:', error);
    return res.status(500).json({ error: 'Registration failed' });
  }
});



router.post("/verify-email-code", async (req, res) => {
  const { email, code } = req.body;

  try {
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(404).json({ error: "User not found" });

    if (
      user.verificationCode !== code ||
      !user.verificationCodeExpires ||
      user.verificationCodeExpires < new Date()
    ) {
      return res.status(401).json({ error: "Invalid or expired code" });
    }

    // Clear verification code + mark verified
    user.verificationCode = undefined;
    user.verificationCodeExpires = undefined;
    user.emailVerified = true;
    await user.save();

    // Sign a token
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "90d",
    });

    res.status(200).json({
      message: "Email verified successfully",
      token,
      user: {
        _id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        emailVerified: true,
      },
    });
  } catch (err) {
    console.error("❌ Verification error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// 📩 Forgot Password
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required." });

  try {
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(404).json({ error: "No user found with this email." });

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetCode = resetCode;
    user.resetCodeExpires = Date.now() + 15 * 60 * 1000; // 15 mins
    await user.save();

    await sendEmail(
      user.email,
      "Reset your Scene password 🎬",
      `Here’s your password reset code: ${resetCode}`
    );

    res.status(200).json({ message: "Reset code sent to your email." });
  } catch (err) {
    console.error("❌ Forgot password error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ✅ Verify reset code
// router.post("/verify-email-code", async (req, res) => {
  // const { email, code } = req.body;

  // try {
  //  const user = await User.findOne({ email: email.toLowerCase().trim() });
   // if (!user) return res.status(404).json({ error: "User not found" });

   // if (
    //  user.verificationCode !== code ||
    //  !user.verificationCodeExpires ||
    //  user.verificationCodeExpires < new Date()
   // ) {
   //   return res.status(401).json({ error: "Invalid or expired code" });
   // }

    // Clear verification code + mark verified
   // user.verificationCode = undefined;
  //  user.verificationCodeExpires = undefined;
   // user.emailVerified = true;
   // await user.save();

    // Sign a token
   // const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "90d" });

    //res.status(200).json({
     // message: "Email verified successfully",
     // token,
     // user: {
     //   _id: user._id,
     //  name: user.name,
      //  username: user.username,
    //    email: user.email,
     //   avatar: user.avatar,
    //  },
  //  });
//  } catch (err) {
 //   console.error("❌ Verification error:", err);
 //   res.status(500).json({ error: "Server error" });
 // }
// });

router.post("/resend-email-code", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required." });

  try {
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(404).json({ error: "User not found." });
    if (user.emailVerified) return res.status(400).json({ error: "Email already verified." });

    const verificationCode = crypto.randomInt(100000, 999999).toString();
    user.verificationCode = verificationCode;
    user.verificationCodeExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    await sendEmail(
      user.email,
      "Your Scene verification code",
      `Here’s your new verification code:\n\n${verificationCode}\n\nIt expires in 10 minutes.`
    );

    res.status(200).json({ message: "New verification code sent." });
  } catch (err) {
    console.error("❌ Resend verification error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// ✅ Reset password
router.post("/reset-password", async (req, res) => {

  console.log("🔁 RESET PASSWORD HIT");
  const { email, code, newPassword } = req.body;

  try {
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(404).json({ error: "User not found." });

    if (
      user.resetCode !== code ||
      !user.resetCodeExpires ||
      user.resetCodeExpires < new Date()
    ) {
      return res.status(401).json({ error: "Invalid or expired reset code." });
    }

    // ✅ Just assign the new password directly — pre-save hook will hash it
    user.password = newPassword;

    // Clear reset fields
    user.resetCode = undefined;
    user.resetCodeExpires = undefined;

    await user.save();

    res.status(200).json({ message: "Password has been reset successfully." });
  } catch (err) {
    console.error("❌ Reset password error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.post("/request-reset-code", async (req, res) => {
  const { username, email } = req.body;

  if (!username || !email) {
    return res.status(400).json({ error: "Username and email are required." });
  }

  try {
    const user = await User.findOne({
      username: { $regex: `^${username}$`, $options: "i" },
      email: email.toLowerCase().trim()
    });

    if (!user) {
      return res.status(404).json({ error: "No user found with that username and email." });
    }

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetCode = resetCode;
    user.resetCodeExpires = Date.now() + 15 * 60 * 1000;
    await user.save();

    await sendEmail(
      user.email,
      "Reset your Scene password 🎬",
      `Here’s your password reset code: ${resetCode}`
    );

    res.status(200).json({ message: "Reset code sent to your email." });
  } catch (err) {
    console.error("❌ request-reset-code error:", err);
    res.status(500).json({ error: "Something went wrong." });
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
      expiresIn: '90d',
    });
    

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        emailVerified: user.emailVerified,  // ✅ Added
      },
    
    });
  } catch (err) {
    console.error('❌ Google token verification failed:', err);
    res.status(401).json({ error: 'Invalid token' });
  }
});

// 🔐 Login
router.post('/login', async (req, res, next) => {
  try {
    const { email, username, password } = req.body || {};
    if (!password || (!email && !username)) {
      return res.status(400).json({ error: 'Email/Username and password are required' });
    }

    const query = email
      ? { email: String(email).toLowerCase().trim() }
      : { username: String(username).trim() };

    // Select password explicitly (schema often has select:false)
    const user = await User.findOne(query).select('+password');
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Some Google-only accounts have no real hash
    if (!user.password || user.password === 'google-oauth') {
      return res.status(401).json({ error: 'Account requires Google login' });
    }

    // Use your model method if present; otherwise compare safely
    let isMatch = false;
    if (typeof user.matchPassword === 'function') {
      isMatch = await user.matchPassword(password);
    } else {
      const bcrypt = require('bcryptjs');
      isMatch = await bcrypt.compare(password, user.password);
    }

    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '90d' });

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    return next(error);
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

    // Username
    if (username) {
      const uname = username.toLowerCase().trim();
      if (uname !== user.username) {
        const exists = await User.findOne({
          _id: { $ne: user._id },
          username: { $regex: `^${uname}$`, $options: 'i' }
        });
        if (exists) return res.status(400).json({ error: 'Username already taken' });
        user.username = uname;
      }
    }

    // Email (validate deliverability + uniqueness, then re-verify)
    if (email) {
      const newEmail = email.toLowerCase().trim();
      if (newEmail !== user.email) {
        const check = await validateEmailDeliverability(newEmail);
        if (!check.ok) {
          return res.status(400).json({
            error: 'Please use a real, deliverable email address',
            reason: check.reason,
          });
        }

        const emailTaken = await User.findOne({ _id: { $ne: user._id }, email: newEmail });
        if (emailTaken) return res.status(400).json({ error: 'Email already in use' });

        user.email = newEmail;
        user.emailVerified = false;

        const verificationCode = crypto.randomInt(100000, 999999).toString();
        user.verificationCode = verificationCode;
        user.verificationCodeExpires = new Date(Date.now() + 10 * 60 * 1000);

        await sendEmail(
          newEmail,
          "Verify your new email for Scene",
          `Here’s your code: ${verificationCode}\n\nIt expires in 10 minutes.`
        );
      }
    }

    if (password) user.password = password; // hashed in pre-save
    if (bio !== undefined) user.bio = bio;
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
        emailVerified: !!user.emailVerified,
      },
    });
  } catch (error) {
    console.error('❌ Update profile error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/users/save-token
router.post("/save-token", protect, async (req, res) => {
  try {
    const { deviceToken } = req.body;
    console.log("💡 Saving device token:", deviceToken, "for user:", req.user._id);
    if (!deviceToken || typeof deviceToken !== "string") {
      return res.status(400).json({ error: "Device token required" });
    }

    // Use instance method to dedupe + save
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: "User not found" });

    await user.addDeviceToken(deviceToken.trim());
    return res.json({ success: true, deviceTokens: user.deviceTokens });
  } catch (err) {
    console.error("❌ Failed to save device token:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/me/device-tokens", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("deviceTokens");
    if (!user) return res.status(404).json({ error: "User not found" });
    return res.json({ deviceTokens: user.deviceTokens || [] });
  } catch (err) {
    console.error("❌ /me/device-tokens error:", err);
    return res.status(500).json({ error: err.message });
  }
});


// DELETE /api/users/remove-token
router.delete("/remove-token", protect, async (req, res) => {
  try {
    const { deviceToken } = req.body;
    if (!deviceToken || typeof deviceToken !== "string") {
      return res.status(400).json({ error: "Device token required" });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: "User not found" });

    await user.removeDeviceToken(deviceToken.trim());
    return res.json({ success: true, deviceTokens: user.deviceTokens });
  } catch (err) {
    console.error("❌ Failed to remove device token:", err);
    return res.status(500).json({ success: false, error: err.message });
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

router.delete('/account', protect, async (req, res) => {
  try {
    const userId = req.user._id;

    // Delete related docs (extend as needed)
    await Promise.all([
      Log.deleteMany({ user: userId }),
      Notification.deleteMany({ $or: [{ to: userId }, { from: userId }] }),
      CustomPoster.deleteMany({ userId }),
      User.updateMany({}, { $pull: { followers: userId, following: userId } }),
    ]);

    await User.deleteOne({ _id: userId });

    res.status(200).json({ message: 'Account deleted successfully' });
  } catch (err) {
    console.error('❌ Delete account error:', err);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});


// 🔁 Ping
router.get('/ping', (req, res) => {
  res.send('Auth route is working!');
});

console.log('✅ auth.js is loaded');
module.exports = router;
