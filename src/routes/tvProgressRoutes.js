// src/routes/tvProgressRoutes.js

const express = require("express");

const router = express.Router();

const protect = require(
  "../middleware/authMiddleware"
);

const {
  rebuildUserShowProgress,
  rebuildAllUserShowProgress,

  getUserShowProgress,
  getUserSeasonProgress,

  getContinueWatching,

  getUsersShowProgress,
  getAverageUsersProgress,

  getUserTVProgressSummary,
} = require(
  "../services/tvProgressService"
);

const {
  getTVProfileStats,
  getCompleteTVStats,
  getTVActivityStats,
} = require(
  "../services/tvStatsService"
);

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

function parsePositiveInteger(value) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 1
  ) {
    return null;
  }

  return parsed;
}

function parseSeasonNumber(value) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 0
  ) {
    return null;
  }

  return parsed;
}

function parseBoolean(
  value,
  fallback = false
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  if (
    value === true ||
    value === "true" ||
    value === "1"
  ) {
    return true;
  }

  if (
    value === false ||
    value === "false" ||
    value === "0"
  ) {
    return false;
  }

  return fallback;
}

function parseLimit(
  value,
  fallback = 30,
  maximum = 100
) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 1
  ) {
    return fallback;
  }

  return Math.min(
    parsed,
    maximum
  );
}

function serializeProgress(progress) {
  if (!progress) {
    return null;
  }

  if (
    typeof progress.toObject ===
    "function"
  ) {
    return progress.toObject({
      virtuals: true,
    });
  }

  return progress;
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

  const message =
    typeof error?.message ===
    "string"
      ? error.message
      : "";

  if (
    message.startsWith("Invalid")
  ) {
    return res.status(400).json({
      error: message,
    });
  }

  return res.status(500).json({
    error: fallbackMessage,

    details:
      process.env.NODE_ENV ===
      "production"
        ? undefined
        : message || undefined,
  });
}

// ======================================================
// GET /api/tv-progress/continue-watching
//
// Upcoming Episodes tab.
//
// Default:
// - Started shows only
// - Incomplete/caught-up false
// - Most recently watched first
// - Each document contains nextUnwatchedEpisode
// ======================================================

router.get(
  "/continue-watching",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const limit = parseLimit(
        req.query.limit,
        30,
        100
      );

      const includeCaughtUp =
        parseBoolean(
          req.query.includeCaughtUp,
          false
        );

      const progressDocuments =
        await getContinueWatching(
          userId,
          {
            limit,
            includeCaughtUp,
          }
        );

      return res.status(200).json({
        results:
          progressDocuments,

        count:
          progressDocuments.length,

        includeCaughtUp,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch Continue Watching"
      );
    }
  }
);

// ======================================================
// GET /api/tv-progress/stats
//
// Compact TV profile statistics.
// ======================================================

router.get(
  "/stats",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const stats =
        await getTVProfileStats(
          userId
        );

      return res.status(200).json({
        stats,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch TV statistics"
      );
    }
  }
);

// ======================================================
// GET /api/tv-progress/stats/summary
//
// Cached progress-summary totals.
// Useful for lightweight profile headers.
// ======================================================

router.get(
  "/stats/summary",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const summary =
        await getUserTVProgressSummary(
          userId
        );

      return res.status(200).json({
        summary,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch TV progress summary"
      );
    }
  }
);

// ======================================================
// GET /api/tv-progress/stats/complete
//
// Full statistics package.
// ======================================================

router.get(
  "/stats/complete",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const topLimit = parseLimit(
        req.query.topLimit,
        10,
        50
      );

      const activityMonths =
        parseLimit(
          req.query.activityMonths,
          12,
          60
        );

      const stats =
        await getCompleteTVStats(
          userId,
          {
            topLimit,
            activityMonths,
          }
        );

      return res.status(200).json({
        stats,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch complete TV statistics"
      );
    }
  }
);

// ======================================================
// GET /api/tv-progress/stats/activity
//
// Date-range activity.
// Example:
// ?startDate=2026-07-01&endDate=2026-07-31
// ======================================================

router.get(
  "/stats/activity",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const stats =
        await getTVActivityStats(
          userId,
          {
            startDate:
              req.query.startDate ||
              null,

            endDate:
              req.query.endDate ||
              null,
          }
        );

      return res.status(200).json({
        startDate:
          req.query.startDate ||
          null,

        endDate:
          req.query.endDate ||
          null,

        stats,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch TV activity statistics"
      );
    }
  }
);

// ======================================================
// POST /api/tv-progress/rebuild-all
//
// Rebuild every show summary for the current user.
// Useful after imports or metadata repair.
// ======================================================

router.post(
  "/rebuild-all",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const result =
        await rebuildAllUserShowProgress(
          userId
        );

      return res.status(200).json({
        message:
          "All TV progress rebuilt",

        ...result,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to rebuild TV progress"
      );
    }
  }
);

// ======================================================
// GET /api/tv-progress/show/:showTmdbId
//
// Current user's progress for one show.
// ======================================================

router.get(
  "/show/:showTmdbId",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const showTmdbId =
        parsePositiveInteger(
          req.params.showTmdbId
        );

      if (!showTmdbId) {
        return res.status(400).json({
          error: "Invalid show ID",
        });
      }

      const rebuildIfMissing =
        parseBoolean(
          req.query.rebuildIfMissing,
          true
        );

      const progress =
        await getUserShowProgress(
          userId,
          showTmdbId,
          {
            rebuildIfMissing,
          }
        );

      return res.status(200).json({
        showTmdbId,

        hasStarted:
          Boolean(progress),

        progress:
          serializeProgress(
            progress
          ),
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch show progress"
      );
    }
  }
);

// ======================================================
// POST /api/tv-progress/show/:showTmdbId/rebuild
//
// Force-recalculates one show from TVLog + Episode.
// ======================================================

router.post(
  "/show/:showTmdbId/rebuild",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const showTmdbId =
        parsePositiveInteger(
          req.params.showTmdbId
        );

      if (!showTmdbId) {
        return res.status(400).json({
          error: "Invalid show ID",
        });
      }

      const progress =
        await rebuildUserShowProgress(
          userId,
          showTmdbId
        );

      return res.status(200).json({
        message:
          progress
            ? "Show progress rebuilt"
            : "No episode logs found",

        showTmdbId,

        progress:
          serializeProgress(
            progress
          ),
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to rebuild show progress"
      );
    }
  }
);

// ======================================================
// GET /api/tv-progress/show/:showTmdbId/season/:seasonNumber
//
// Detailed season progress and watched state for every
// cached episode.
// ======================================================

router.get(
  "/show/:showTmdbId/season/:seasonNumber",
  protect,
  async (req, res) => {
    try {
      const userId =
        getAuthenticatedUserId(req);

      const showTmdbId =
        parsePositiveInteger(
          req.params.showTmdbId
        );

      const seasonNumber =
        parseSeasonNumber(
          req.params.seasonNumber
        );

      if (
        !showTmdbId ||
        seasonNumber === null
      ) {
        return res.status(400).json({
          error:
            "Invalid show or season number",
        });
      }

      const progress =
        await getUserSeasonProgress(
          userId,
          showTmdbId,
          seasonNumber
        );

      return res.status(200).json({
        showTmdbId,
        seasonNumber,
        progress,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch season progress"
      );
    }
  }
);

// ======================================================
// POST /api/tv-progress/show/:showTmdbId/users
//
// Calculates progress for a supplied set of users.
//
// This is an internal building block for the future Show
// page's followed-user percentage. The caller should pass
// only IDs it is authorized to view.
// ======================================================

router.post(
  "/show/:showTmdbId/users",
  protect,
  async (req, res) => {
    try {
      const showTmdbId =
        parsePositiveInteger(
          req.params.showTmdbId
        );

      if (!showTmdbId) {
        return res.status(400).json({
          error: "Invalid show ID",
        });
      }

      const userIds =
        Array.isArray(
          req.body?.userIds
        )
          ? req.body.userIds
          : [];

      if (userIds.length > 500) {
        return res.status(400).json({
          error:
            "A maximum of 500 users is allowed",
        });
      }

      const result =
        await getAverageUsersProgress(
          userIds,
          showTmdbId
        );

      return res.status(200).json({
        showTmdbId,

        averageProgressPercentage:
          result.averageProgressPercentage,

        userCount:
          result.userCount,

        users:
          result.users,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch users’ show progress"
      );
    }
  }
);

// ======================================================
// POST /api/tv-progress/show/:showTmdbId/user-progress
//
// Raw multi-user progress without average calculation.
// ======================================================

router.post(
  "/show/:showTmdbId/user-progress",
  protect,
  async (req, res) => {
    try {
      const showTmdbId =
        parsePositiveInteger(
          req.params.showTmdbId
        );

      if (!showTmdbId) {
        return res.status(400).json({
          error: "Invalid show ID",
        });
      }

      const userIds =
        Array.isArray(
          req.body?.userIds
        )
          ? req.body.userIds
          : [];

      if (userIds.length > 500) {
        return res.status(400).json({
          error:
            "A maximum of 500 users is allowed",
        });
      }

      const users =
        await getUsersShowProgress(
          userIds,
          showTmdbId
        );

      return res.status(200).json({
        showTmdbId,
        count: users.length,
        users,
      });
    } catch (error) {
      return handleError(
        error,
        res,
        "Failed to fetch user progress"
      );
    }
  }
);

// ======================================================
// Export
// ======================================================

module.exports = router;

