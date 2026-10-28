
const express = require("express");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const cloudinary = require("cloudinary").v2;

const OrganizationApplication = require("../models/OrganizationApplication");
const { sendOrganizationApplication } = require("../services/telegramBot");

// Important: this loads the existing Cloudinary configuration.
require("../utils/cloudinary");

const router = express.Router();

const MAX_LOGO = 3 * 1024 * 1024;
const MAX_DOCUMENT = 5 * 1024 * 1024;

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again later." },
});

const uploader = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_DOCUMENT,
    files: 2,
    fields: 8,
    fieldSize: 12000,
  },
}).fields([
  { name: "logo", maxCount: 1 },
  { name: "document", maxCount: 1 },
]);

function uploadMiddleware(req, res, next) {
  uploader(req, res, (error) => {
    if (error) {
      return res.status(400).json({
        error: error instanceof multer.MulterError
          ? "Invalid upload or upload limit exceeded."
          : "Invalid upload.",
      });
    }
    next();
  });
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validLogo(file) {
  if (!file || file.size > MAX_LOGO) return false;

  const b = file.buffer;
  const png = b.length >= 8 &&
    b.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    );

  const jpg = b.length >= 4 &&
    b[0] === 0xff && b[1] === 0xd8 &&
    b[2] === 0xff;

  const webp = b.length >= 12 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP";

  return png || jpg || webp;
}

function validPdf(file) {
  if (!file || file.size > MAX_DOCUMENT) return false;
  return file.buffer.length >= 5 &&
    file.buffer.toString("ascii", 0, 5) === "%PDF-";
}

function uploadBuffer(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) return reject(error);
        if (!result?.public_id) {
          return reject(new Error("Cloudinary upload failed"));
        }
        resolve(result);
      }
    );

    stream.end(buffer);
  });
}

async function removeUploadedAssets(assets) {
  const results = await Promise.allSettled(
    assets.map((asset) =>
      cloudinary.uploader.destroy(asset.public_id, {
        resource_type: asset.resource_type,
        type: asset.type,
        invalidate: true,
      })
    )
  );

  results.forEach((result, index) => {
    if (
      result.status === "rejected" ||
      result.value?.result !== "ok"
    ) {
      console.error(
        "Cloudinary cleanup requires attention:",
        assets[index].public_id,
        result.status === "rejected"
          ? result.reason?.message
          : result.value?.result
      );
    }
  });
}

router.post("/apply", limiter, uploadMiddleware, async (req, res) => {
  const uploadedAssets = [];
  let applicationSaved = false;

  try {
    const name = clean(req.body.name);
    const username = clean(req.body.username).toLowerCase();
    const email = clean(req.body.email).toLowerCase();
    const bio = clean(req.body.bio);
    const password = req.body.password;

    const logo = req.files?.logo?.[0];
    const document = req.files?.document?.[0];

    if (
      !name || !username || !email || !bio ||
      typeof password !== "string" || !logo
    ) {
      return res.status(400).json({
        error: "Please complete all required fields.",
      });
    }

    if (name.length > 120 || bio.length > 1000) {
      return res.status(400).json({
        error: "Name or bio exceeds the permitted length.",
      });
    }

    if (!/^[a-zA-Z0-9_.-]{2,40}$/.test(username)) {
      return res.status(400).json({
        error: "Invalid organization username.",
      });
    }

    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return res.status(400).json({
        error: "Invalid email address.",
      });
    }

    if (password.length < 12 || password.length > 72) {
      return res.status(400).json({
        error: "Password must be 12–72 characters.",
      });
    }

    if (!validLogo(logo)) {
      return res.status(400).json({
        error: "Logo must be a valid PNG, JPEG, or WebP under 3 MB.",
      });
    }

    if (document && !validPdf(document)) {
      return res.status(400).json({
        error: "Company document must be a valid PDF under 5 MB.",
      });
    }

    const existing = await OrganizationApplication.exists({
      $or: [{ username }, { email }],
    });

    if (existing) {
      return res.status(409).json({
        error: "Email or username is already registered.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Public organization logo.
    const logoResult = await uploadBuffer(logo.buffer, {
      folder: "scene/organization-logos",
      resource_type: "image",
      type: "upload",
    });

    uploadedAssets.push({
      public_id: logoResult.public_id,
      resource_type: "image",
      type: "upload",
    });

    let documentPublicId = null;
    let documentName = null;

    // Private company document. Do NOT expose its URL.
    if (document) {
      const documentResult = await uploadBuffer(
        document.buffer,
        {
          folder: "scene/organization-documents",
          resource_type: "raw",
          type: "authenticated",
        }
      );

      documentPublicId = documentResult.public_id;
      documentName = document.originalname.slice(0, 150);

      uploadedAssets.push({
        public_id: documentPublicId,
        resource_type: "raw",
        type: "authenticated",
      });
    }

    const application = await OrganizationApplication.create({
      name,
      username,
      email,
      bio,
      passwordHash,
      logoUrl: logoResult.secure_url,
      logoPublicId: logoResult.public_id,
      documentPublicId,
      documentName,
      status: "pending",
      telegramNotified: false,
    });

    applicationSaved = true;

    // Once saved, a notification error must not undo registration.
    try {
      await sendOrganizationApplication({
        _id: application._id,
        name,
        username,
        email,
        bio,
        documentUrl: documentName
          ? "Private document attached"
          : "",
      });

      await OrganizationApplication.updateOne(
        { _id: application._id },
        { $set: { telegramNotified: true } }
      );
    } catch (error) {
      console.error(
        "Organization Telegram notification failed:",
        error.message
      );
    }

    return res.status(201).json({
      success: true,
      message: "Your organization application has been received.",
      applicationId: application._id,
      status: "pending",
    });

  } catch (error) {
    // Never delete assets belonging to a saved application.
    if (!applicationSaved) {
      await removeUploadedAssets(uploadedAssets);
    }

    if (error.code === 11000) {
      return res.status(409).json({
        error: "Email or username is already registered.",
      });
    }

    console.error(
      "Organization registration failed:",
      error.message
    );

    return res.status(500).json({
      error: "Unable to submit application.",
    });
  }
});

module.exports = router;
