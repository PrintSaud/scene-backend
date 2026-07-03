const crypto = require("crypto");
const jwt = require("jsonwebtoken");

function getAccessTokenLifetime() {
  // Keep the current long lifetime during migration.
  // We will reduce this only after the mobile refresh flow works.
  return process.env.ACCESS_TOKEN_EXPIRES_IN || "9000d";
}

function getRefreshTokenDays() {
  const parsed = Number.parseInt(
    process.env.REFRESH_TOKEN_DAYS || "365",
    10
  );

  if (!Number.isFinite(parsed) || parsed < 1) {
    return 365;
  }

  return parsed;
}

function signAccessToken(userId, sessionId) {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.sign(
    {
      id: String(userId),
      sid: String(sessionId),
    },
    process.env.JWT_SECRET,
    {
      expiresIn: getAccessTokenLifetime(),
      algorithm: "HS256",
    }
  );
}

function generateRefreshToken() {
  // 64 random bytes represented as hexadecimal.
  // This produces a cryptographically secure opaque token.
  return crypto.randomBytes(64).toString("hex");
}

function hashRefreshToken(refreshToken) {
  if (!refreshToken || typeof refreshToken !== "string") {
    throw new Error("Refresh token is required");
  }

  return crypto
    .createHash("sha256")
    .update(refreshToken)
    .digest("hex");
}

function getRefreshTokenExpiry() {
  const expiresAt = new Date();

  expiresAt.setDate(
    expiresAt.getDate() + getRefreshTokenDays()
  );

  return expiresAt;
}

module.exports = {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  getRefreshTokenExpiry,
};