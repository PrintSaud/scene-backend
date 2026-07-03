const mongoose = require("mongoose");

const SessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Only the SHA-256 hash is stored.
    // The real refresh token never enters MongoDB.
    refreshTokenHash: {
      type: String,
      required: true,
      unique: true,
    },

    deviceId: {
      type: String,
      default: "",
      trim: true,
    },

    platform: {
      type: String,
      enum: ["ios", "android", "web", "unknown"],
      default: "unknown",
    },

    userAgent: {
      type: String,
      default: "",
    },

    expiresAt: {
      type: Date,
      required: true,
    },

    lastUsedAt: {
      type: Date,
      default: Date.now,
    },

    revokedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Automatically remove expired session documents from MongoDB.
SessionSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
);

// Quickly find active sessions belonging to one user.
SessionSchema.index({
  user: 1,
  revokedAt: 1,
});

module.exports =
  mongoose.models.Session ||
  mongoose.model("Session", SessionSchema);