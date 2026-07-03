const jwt = require("jsonwebtoken");
const User = require("../models/user");
const Session = require("../models/session");

const protect = async (req, res, next) => {
  const authorization =
    typeof req.headers.authorization === "string"
      ? req.headers.authorization.trim()
      : "";

  if (
    !authorization ||
    !authorization.toLowerCase().startsWith("bearer ")
  ) {
    return res.status(401).json({
      error: "Not authorized, no token",
    });
  }

  const token = authorization.slice(7).trim();

  if (!token) {
    return res.status(401).json({
      error: "Not authorized, no token",
    });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET,
      {
        algorithms: ["HS256"],
      }
    );

    if (!decoded?.id) {
      return res.status(401).json({
        error: "Token is invalid or expired",
      });
    }

    /*
     * New access tokens contain a session ID.
     * Require that session to still be active.
     *
     * Older tokens do not contain sid, so they remain valid
     * during the migration and existing users stay logged in.
     */
    if (decoded.sid) {
      const activeSession = await Session.exists({
        _id: decoded.sid,
        user: decoded.id,
        revokedAt: null,
        expiresAt: {
          $gt: new Date(),
        },
      });

      if (!activeSession) {
        return res.status(401).json({
          error: "Session is invalid or expired",
        });
      }
    }

    const user = await User.findById(decoded.id).select(
      "-password -resetCode -resetCodeExpires -verificationCode -verificationCodeExpires"
    );

    if (!user) {
      return res.status(401).json({
        error: "User not found",
      });
    }

    req.user = user;
    req.auth = {
      userId: decoded.id,
      sessionId: decoded.sid || null,
    };

    return next();
  } catch (error) {
    console.error(
      "❌ JWT authentication failed:",
      error.message
    );

    return res.status(401).json({
      error: "Token is invalid or expired",
    });
  }
};

module.exports = protect;