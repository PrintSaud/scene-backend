// src/routes/tvModeRoutes.js

const express = require("express");

const router = express.Router();

const protect = require(
  "../middleware/authMiddleware"
);

const User = require(
  "../models/user"
);

// ======================================================
// Constants
// ======================================================

const VALID_MODES = new Set([
  "movies",
  "tv",
]);

// ======================================================
// Helpers
// ======================================================

function getAuthenticatedUserId(req) {
  return (
    req.user?._id ||
    req.user?.id ||
    null
  );
}

function normalizeMode(value) {
  if (
    typeof value !== "string"
  ) {
    return null;
  }

  const mode =
    value
      .trim()
      .toLowerCase();

  return VALID_MODES.has(mode)
    ? mode
    : null;
}

function serializeMode(user) {
  const preferredMode =
    VALID_MODES.has(
      user?.preferredMode
    )
      ? user.preferredMode
      : "movies";

  return {
    preferredMode,

    isMovieMode:
      preferredMode ===
      "movies",

    isTVMode:
      preferredMode ===
      "tv",
  };
}

function handleError(
  error,
  res,
  fallbackMessage
) {
  console.error(
    `❌ ${fallbackMessage}:`,
    error?.stack || error
  );

  return res.status(500).json({
    error:
      fallbackMessage,

    details:
      process.env.NODE_ENV ===
      "production"
        ? undefined
        : error?.message ||
          undefined,
  });
}

// ======================================================
// GET /api/tv-mode
//
// Returns the authenticated user's shared Scene mode.
//
// This controls:
// - Home
// - Profile
// - Notifications
// ======================================================

router.get(
  "/",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const user =
        await User.findById(
          userId
        )
          .select(
            "preferredMode"
          )
          .lean();

      if (!user) {
        return res.status(404).json({
          error:
            "User not found",
        });
      }

      return res.status(200).json({
        ...serializeMode(
          user
        ),
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch Scene mode"
      );
    }
  }
);

// ======================================================
// PATCH /api/tv-mode
//
// Explicitly sets the shared mode.
//
// Body:
// {
//   "mode": "tv"
// }
//
// Also accepts:
// {
//   "preferredMode": "tv"
// }
// ======================================================

router.patch(
  "/",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const mode =
        normalizeMode(
          req.body?.mode ??
          req.body?.preferredMode
        );

      if (!mode) {
        return res.status(400).json({
          error:
            'Mode must be either "movies" or "tv"',
        });
      }

      const user =
        await User.findByIdAndUpdate(
          userId,
          {
            $set: {
              preferredMode:
                mode,
            },
          },
          {
            new: true,
            runValidators: true,
          }
        )
          .select(
            "preferredMode"
          )
          .lean();

      if (!user) {
        return res.status(404).json({
          error:
            "User not found",
        });
      }

      return res.status(200).json({
        message:
          mode === "tv"
            ? "Scene switched to TV mode"
            : "Scene switched to Movies mode",

        ...serializeMode(
          user
        ),
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to update Scene mode"
      );
    }
  }
);

// ======================================================
// POST /api/tv-mode/toggle
//
// Toggles between Movies and TV.
//
// Useful for a single switch button in the app.
// ======================================================

router.post(
  "/toggle",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const user =
        await User.findById(
          userId
        ).select(
          "preferredMode"
        );

      if (!user) {
        return res.status(404).json({
          error:
            "User not found",
        });
      }

      const currentMode =
        VALID_MODES.has(
          user.preferredMode
        )
          ? user.preferredMode
          : "movies";

      const nextMode =
        currentMode === "tv"
          ? "movies"
          : "tv";

      user.preferredMode =
        nextMode;

      await user.save();

      return res.status(200).json({
        message:
          nextMode === "tv"
            ? "Scene switched to TV mode"
            : "Scene switched to Movies mode",

        previousMode:
          currentMode,

        ...serializeMode(
          user
        ),
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to toggle Scene mode"
      );
    }
  }
);

// ======================================================
// POST /api/tv-mode/movies
//
// Convenience endpoint.
// ======================================================

router.post(
  "/movies",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const user =
        await User.findByIdAndUpdate(
          userId,
          {
            $set: {
              preferredMode:
                "movies",
            },
          },
          {
            new: true,
            runValidators: true,
          }
        )
          .select(
            "preferredMode"
          )
          .lean();

      if (!user) {
        return res.status(404).json({
          error:
            "User not found",
        });
      }

      return res.status(200).json({
        message:
          "Scene switched to Movies mode",

        ...serializeMode(
          user
        ),
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to switch to Movies mode"
      );
    }
  }
);

// ======================================================
// POST /api/tv-mode/tv
//
// Convenience endpoint.
// ======================================================

router.post(
  "/tv",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const user =
        await User.findByIdAndUpdate(
          userId,
          {
            $set: {
              preferredMode:
                "tv",
            },
          },
          {
            new: true,
            runValidators: true,
          }
        )
          .select(
            "preferredMode"
          )
          .lean();

      if (!user) {
        return res.status(404).json({
          error:
            "User not found",
        });
      }

      return res.status(200).json({
        message:
          "Scene switched to TV mode",

        ...serializeMode(
          user
        ),
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to switch to TV mode"
      );
    }
  }
);

// ======================================================
// Export
// ======================================================

module.exports = router;