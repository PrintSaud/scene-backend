
const mongoose = require("mongoose");

const organizationApplicationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      match: /^[a-zA-Z0-9_.-]{2,40}$/,
    },

    bio: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },

    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },

    passwordHash: {
      type: String,
      required: true,
      select: false,
    },

    logoUrl: {
      type: String,
      required: true,
    },

    logoPublicId: String,

    documentName: {
      type: String,
      default: null,
    },

    documentPublicId: {
      type: String,
      default: null,
      select: false,
    },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },

    telegramNotified: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "OrganizationApplication",
  organizationApplicationSchema
);
