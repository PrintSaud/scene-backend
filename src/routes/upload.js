const express = require("express");
const router = express.Router();
const multer = require("multer");
const streamifier = require("streamifier");
const cloudinary = require("../utils/cloudinary");
const protect = require("../middleware/authMiddleware");

const User = require("../models/user");

// Use memory storage for multer (we don't save locally)
const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post("/list-cover", protect, upload.single("image"), async (req, res) => {
    try {
      const b64 = Buffer.from(req.file.buffer).toString("base64");
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;
      const uploadResult = await cloudinary.uploader.upload(dataURI, {
        folder: "scene/list-covers",
      });
      res.json({ url: uploadResult.secure_url });
    } catch (err) {
      res.status(500).json({ message: "Upload failed", error: err });
    }
  });

router.post("/:id/upload-avatar", upload.single("avatar"), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const streamUpload = (fileBuffer) => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: "avatars", // Optional: to group uploads
            public_id: `${user._id}-${Date.now()}`, // Optional: unique name
          },
          (error, result) => {
            if (result) resolve(result);
            else reject(error);
          }
        );

        streamifier.createReadStream(fileBuffer).pipe(stream);
      });
    };

    const result = await streamUpload(req.file.buffer);

    user.avatar = result.secure_url;
    await user.save();

    res.status(200).json({ message: "Avatar uploaded successfully", avatar: result.secure_url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
