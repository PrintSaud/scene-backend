// src/routes/upload.js

const express = require("express");
const multer = require("multer");
const mongoose = require("mongoose");

const router = express.Router();

const protect = require("../middleware/authMiddleware");
const User = require("../models/user");
const {
  uploadToCloudinary,
} = require("../utils/cloudinary");

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 8 * 1024 * 1024,
  },

  fileFilter: (req, file, callback) => {
    if (
      file.mimetype &&
      file.mimetype.startsWith("image/")
    ) {
      return callback(null, true);
    }

    return callback(
      new multer.MulterError(
        "LIMIT_UNEXPECTED_FILE",
        file.fieldname
      )
    );
  },
});

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

function handleUploadError(error, res) {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        message:
          "Image must be smaller than 8 MB",
      });
    }

    return res.status(400).json({
      message:
        "Only valid image uploads are allowed",
    });
  }

  console.error("❌ Upload failed:", error);

  return res.status(500).json({
    message: "Upload failed",
  });
}


// POST /api/upload/list-cover
// Upload a list cover for the authenticated user.
router.post(
  "/list-cover",
  protect,
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          message: "No image received",
        });
      }

      const url = await uploadToCloudinary(
        req.file.buffer,
        "scene/list-covers"
      );

      return res.status(200).json({
        url,
      });
    } catch (error) {
      return handleUploadError(
        error,
        res
      );
    }
  }
);


// POST /api/upload/avatar/:id
// Upload an avatar for the authenticated user's own account.
router.post(
  "/avatar/:id",
  protect,
  upload.single("avatar"),
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          message: "Invalid user ID",
        });
      }

      if (
        String(req.user._id) !== String(id)
      ) {
        return res.status(403).json({
          message:
            "Not authorized to update this avatar",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          message: "No file received",
        });
      }

      const user = await User.findById(id);

      if (!user) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      const avatarUrl =
        await uploadToCloudinary(
          req.file.buffer,
          "scene/avatars"
        );

      user.avatar = avatarUrl;
      await user.save();

      return res.status(200).json({
        message:
          "Avatar uploaded successfully",
        avatar: avatarUrl,
      });
    } catch (error) {
      return handleUploadError(
        error,
        res
      );
    }
  }
);


// Handle Multer errors raised before route handlers execute.
router.use((error, req, res, next) => {
  if (error) {
    return handleUploadError(
      error,
      res
    );
  }

  return next();
});


module.exports = router;

