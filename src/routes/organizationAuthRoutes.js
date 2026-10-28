
const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");

const OrganizationApplication = require(
  "../models/OrganizationApplication"
);

const OrganizationSession = require(
  "../models/OrganizationSession"
);

const organizationAuth = require(
  "../middleware/organizationAuth"
);

const router = express.Router();

const SESSION_LIFETIME = 24 * 60 * 60 * 1000;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "Too many login attempts. Try again later.",
  },
});

function hashToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

function publicOrganization(org) {
  return {
    id: org._id,
    name: org.name,
    username: org.username,
    email: org.email,
    bio: org.bio,
    logoUrl: org.logoUrl,
    status: org.status,
  };
}

// POST /api/organization-auth/login
router.post("/login", loginLimiter, async (req, res) => {
  try {
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const password = req.body?.password;

    if (
      !email ||
      typeof password !== "string" ||
      password.length > 1024
    ) {
      return res.status(400).json({
        error: "Email and password are required.",
      });
    }

    // Include the hash explicitly because the schema
    // excludes it from ordinary queries.
    const org = await OrganizationApplication.findOne({
      email,
    }).select("+passwordHash");

    // Generic error prevents revealing which emails exist.
    const invalidCredentials = {
      error: "Invalid credentials or account not approved.",
    };

    if (!org) {
      return res.status(401).json(invalidCredentials);
    }

    const valid = await bcrypt.compare(
      password,
      org.passwordHash
    );

    if (!valid || org.status !== "approved") {
      return res.status(401).json(invalidCredentials);
    }

    const token = crypto.randomBytes(32).toString("hex");

    const session = await OrganizationSession.create({
      organization: org._id,
      tokenHash: hashToken(token),
      expiresAt: new Date(
        Date.now() + SESSION_LIFETIME
      ),
    });

    return res.json({
      success: true,
      token,
      expiresAt: session.expiresAt,
      organization: publicOrganization(org),
    });
  } catch (error) {
    console.error("Organization login error:", error.message);
    return res.status(500).json({
      error: "Unable to log in.",
    });
  }
});

// GET /api/organization-auth/me
router.get("/me", organizationAuth, (req, res) => {
  return res.json({
    organization: publicOrganization(req.organization),
  });
});

// POST /api/organization-auth/logout
router.post("/logout", organizationAuth, async (req, res) => {
  try {
    await OrganizationSession.updateOne(
      { _id: req.organizationSession._id },
      { $set: { revokedAt: new Date() } }
    );

    return res.json({
      success: true,
      message: "Logged out successfully.",
    });
  } catch (error) {
    return res.status(500).json({
      error: "Unable to log out.",
    });
  }
});

module.exports = router;
