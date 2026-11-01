// src/server.js

// 🌍 Load environment variables first.
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const http = require("http");
const admin = require("firebase-admin");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

const Session = require("./models/session");

const {
  setIO,
} = require("./utils/socketInstance");

// ============================================================
// APP AND SERVER
// ============================================================

const app = express();
const server = http.createServer(app);

const PORT = Number(
  process.env.PORT || 8080
);

const DB_URI =
  process.env.DB_URI;

app.set("trust proxy", 1);

// ============================================================
// ROUTE IMPORTS — TV
// ============================================================

const showRoutes = require(
  "./routes/showRoutes"
);

const seasonRoutes = require(
  "./routes/seasonRoutes"
);

const episodeRoutes = require(
  "./routes/episodeRoutes"
);

const tvSearchRoutes = require(
  "./routes/tvSearchRoutes"
);

const tvLogRoutes = require(
  "./routes/tvLogRoutes"
);

const tvProgressRoutes = require(
  "./routes/tvProgressRoutes"
);

const tvFeedRoutes = require(
  "./routes/tvFeedRoutes"
);

const tvProfileRoutes = require(
  "./routes/tvProfileRoutes"
);

const tvWatchlistRoutes = require(
  "./routes/tvWatchlistRoutes"
);

const tvHomeRoutes = require(
  "./routes/tvHomeRoutes"
);

const tvListRoutes = require(
  "./routes/tvListRoutes"
);

const showReviewRoutes = require(
  "./routes/showReviewRoutes"
);

const showFavoriteCharacterRoutes = require(
  "./routes/showFavoriteCharacterRoutes"
);

const customShowPosterRoutes = require(
  "./routes/customShowPosterRoutes"
);

const customEpisodeBackdropRoutes = require(
  "./routes/customEpisodeBackdropRoutes"
);

const tvModeRoutes = require(
  "./routes/tvModeRoutes"
);

// ============================================================
// ENVIRONMENT VALIDATION
// ============================================================

if (!DB_URI) {
  console.error(
    "❌ Missing required environment variable: DB_URI"
  );
}

if (!process.env.JWT_SECRET) {
  console.error(
    "❌ Missing required environment variable: JWT_SECRET"
  );
}

// Never print actual secret values.
console.warn(
  "🧪 NODE_ENV:",
  process.env.NODE_ENV ||
    "development"
);

console.warn(
  "🧪 DB_URI:",
  DB_URI
    ? "set"
    : "missing"
);

console.warn(
  "🧪 JWT_SECRET:",
  process.env.JWT_SECRET
    ? "set"
    : "missing"
);

console.warn(
  "🧪 TMDB_API_KEY:",
  process.env.TMDB_API_KEY
    ? "set"
    : "missing"
);

console.warn(
  "🧪 FIREBASE_SERVICE_ACCOUNT_BASE64:",
  process.env
    .FIREBASE_SERVICE_ACCOUNT_BASE64
    ? "set"
    : "missing"
);

mongoose.set(
  "debug",
  process.env.NODE_ENV !==
    "production"
);

// ============================================================
// FIREBASE
// ============================================================

function initializeFirebase() {
  if (admin.apps.length > 0) {
    return;
  }

  const encodedServiceAccount =
    process.env
      .FIREBASE_SERVICE_ACCOUNT_BASE64;

  if (!encodedServiceAccount) {
    console.warn(
      "⚠️ Firebase service account is not configured. Push notifications will be unavailable."
    );

    return;
  }

  try {
    const decoded = Buffer.from(
      encodedServiceAccount,
      "base64"
    ).toString("utf8");

    const serviceAccount =
      JSON.parse(decoded);

    admin.initializeApp({
      credential:
        admin.credential.cert(
          serviceAccount
        ),
    });

    console.warn(
      "✅ Firebase Admin initialized"
    );
  } catch (error) {
    console.error(
      "❌ Firebase Admin initialization failed:",
      error.message
    );
  }
}

initializeFirebase();

// ============================================================
// CORS
// ============================================================

const DEFAULT_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:8081",
  "https://scene-frontend-production.up.railway.app",
  "https://scenesa.com",
  "https://www.scenesa.com",
  "https://expo",
];

const configuredOrigins = (
  process.env.FRONTEND_ORIGINS ||
  DEFAULT_ORIGINS.join(",")
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins =
  new Set(configuredOrigins);

const sceneDomainPattern =
  /^https:\/\/([a-z0-9-]+\.)*scenesa\.com$/i;

function isAllowedOrigin(origin) {
  // Native mobile apps, curl, and server-to-server requests
  // may not send an Origin header.
  if (!origin) {
    return true;
  }

  if (
    allowedOrigins.has(origin)
  ) {
    return true;
  }

  if (
    sceneDomainPattern.test(
      origin
    )
  ) {
    return true;
  }

  if (
    process.env.NODE_ENV !==
    "production"
  ) {
    if (
      origin.startsWith(
        "http://localhost:"
      ) ||
      origin.startsWith(
        "http://127.0.0.1:"
      ) ||
      origin.startsWith(
        "exp://"
      ) ||
      origin.startsWith(
        "https://expo"
      )
    ) {
      return true;
    }
  }

  return false;
}

const corsOptions = {
  origin(origin, callback) {
    if (
      isAllowedOrigin(origin)
    ) {
      return callback(
        null,
        true
      );
    }

    return callback(
      Object.assign(
        new Error(
          "Not allowed by CORS"
        ),
        {
          status: 403,
        }
      )
    );
  },

  credentials: true,

  methods: [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
  ],

  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-SceneBot-Review-Secret",
  ],

  maxAge: 86400,
};

app.use(
  cors(corsOptions)
);

app.options(
  "*",
  cors(corsOptions)
);

// ============================================================
// GLOBAL MIDDLEWARE
// ============================================================

app.use(
  express.json({
    limit: "10mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
  })
);

// Do not log bodies, tokens, passwords, or private content.
if (
  process.env.NODE_ENV !==
  "production"
) {
  app.use(
    (req, res, next) => {
      console.log(
        `🔥 ${req.method} ${req.originalUrl}`
      );

      next();
    }
  );
}

// ============================================================
// STATIC FILES AND OG ROUTES
// ============================================================

app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    )
  )
);

app.use(
  "/uploads",
  express.static(
    path.join(
      __dirname,
      "uploads"
    )
  )
);

// OG routes must remain before any future SPA fallback.
app.use(
  "/",
  require("./routes/ogRoutes")
);

// ============================================================
// HEALTH CHECKS
// ============================================================

// Railway must be able to reach this even while Mongo reconnects.
app.get(
  "/health",
  (req, res) => {
    const databaseReady =
      mongoose.connection
        .readyState === 1;

    return res
      .status(200)
      .json({
        ok: true,

        server:
          "running",

        database:
          databaseReady
            ? "connected"
            : "disconnected",
      });
  }
);

app.get(
  "/api/health",
  (req, res) => {
    const databaseReady =
      mongoose.connection
        .readyState === 1;

    return res
      .status(
        databaseReady
          ? 200
          : 503
      )
      .json({
        ok:
          databaseReady,

        database:
          databaseReady
            ? "connected"
            : "unavailable",
      });
  }
);

// ============================================================
// DATABASE
// ============================================================

const mongoOptions = {
  serverSelectionTimeoutMS: 15000,
  family: 4,
};

let mongoRetryTimer = null;
let mongoConnectInProgress = false;

async function connectWithRetry(
  attempt = 1
) {
  if (
    mongoConnectInProgress
  ) {
    return;
  }

  if (!DB_URI) {
    console.error(
      "❌ Cannot connect to MongoDB because DB_URI is missing."
    );

    return;
  }

  mongoConnectInProgress = true;

  try {
    await mongoose.connect(
      DB_URI,
      mongoOptions
    );

    console.warn(
      `✅ MongoDB connected: ${mongoose.connection.name}`
    );
  } catch (error) {
    const delay = Math.min(
      30000,
      attempt * 3000
    );

    console.error(
      `❌ MongoDB connection failed, attempt ${attempt}:`,
      {
        name: error?.name || null,
        code: error?.code || null,
        codeName: error?.codeName || null,
        message: error?.message || null,
        causeName: error?.cause?.name || null,
        causeCode: error?.cause?.code || null,
        causeMessage: error?.cause?.message || null,
      }
    );

    if (error?.reason?.servers) {
      const serverErrors = {};

      for (const [address, description] of error.reason.servers) {
        serverErrors[address] = {
          type: description?.type || null,
          errorName: description?.error?.name || null,
          errorCode: description?.error?.code || null,
          errorMessage: description?.error?.message || null,
        };
      }

      console.error(
        "❌ MongoDB topology details:",
        serverErrors
      );
    }

    clearTimeout(
      mongoRetryTimer
    );

    mongoRetryTimer =
      setTimeout(() => {
        connectWithRetry(
          attempt + 1
        );
      }, delay);
  } finally {
    mongoConnectInProgress = false;
  }
}

connectWithRetry();

function requireDbReady(
  req,
  res,
  next
) {
  if (
    mongoose.connection
      .readyState !== 1
  ) {
    return res
      .status(503)
      .json({
        error:
          "Database temporarily unavailable",
      });
  }

  return next();
}

// All remaining /api routes require MongoDB.
// /api/health was mounted above and remains accessible.
app.use(
  "/api",
  requireDbReady
);

// ============================================================
// API ROUTES — TV
// ============================================================

app.use(
  "/api/tv-logs",
  tvLogRoutes
);

app.use(
  "/api/shows",
  showRoutes
);

app.use(
  "/api/seasons",
  seasonRoutes
);

app.use(
  "/api/episodes",
  episodeRoutes
);

app.use(
  "/api/tv-search",
  tvSearchRoutes
);

app.use(
  "/api/tv-progress",
  tvProgressRoutes
);

app.use(
  "/api/tv-feed",
  tvFeedRoutes
);

app.use(
  "/api/tv-profile",
  tvProfileRoutes
);

app.use(
  "/api/tv-watchlist",
  tvWatchlistRoutes
);

app.use(
  "/api/tv-home",
  tvHomeRoutes
);

app.use(
  "/api/tv-lists",
  tvListRoutes
);

app.use(
  "/api/show-reviews",
  showReviewRoutes
);

app.use(
  "/api/show-favorite-characters",
  showFavoriteCharacterRoutes
);

app.use(
  "/api/custom-show-posters",
  customShowPosterRoutes
);

app.use(
  "/api/custom-episode-backdrops",
  customEpisodeBackdropRoutes
);

app.use(
  "/api/tv-mode",
  tvModeRoutes
);

// ============================================================
// API ROUTES — EXISTING SCENE
// ============================================================

app.use(
  "/api/auth",
  require("./routes/auth")
);

app.use(
  "/api/upload",
  require("./routes/upload")
);

app.use(
  "/api/users",
  require("./routes/user")
);

app.use(
  "/api/logs",
  require("./routes/logRoutes")
);

app.use(
  "/api/watchlist",
  require("./routes/watchlistRoutes")
);

app.use(
  "/api/lists",
  require("./routes/listRoutes")
);

app.use(
  "/api/polls",
  require("./routes/poll")
);

app.use(
  "/api/notifications",
  require("./routes/notification")
);

app.use(
  "/api/search",
  require("./routes/search")
);

app.use(
  "/api/ai",
  require("./routes/ai")
);

app.use(
  "/api/home",
  require("./routes/home")
);

// More specific movie route before /api/movies.
app.use(
  "/api/movies/daily",
  require("./routes/dailyMovie")
);

app.use(
  "/api/movies",
  require("./routes/movieRoutes")
);

const sceneBotRouter =
  require("./routes/sceneBot");

app.use(
  "/api/scene-bot",
  sceneBotRouter
);

/*
 * Temporary compatibility alias for older clients.
 * This points directly to the same secured router.
 * There is no proxy, no secret injection, and no bypass.
 */
app.use(
  "/api/scenebot",
  sceneBotRouter
);

app.use(
  "/api/banners",
  require("./routes/bannerRoutes")
);

app.use(
  "/api/posters",
  require("./routes/posterRoutes")
);

app.use(
  "/api/tmdb",
  require("./routes/tmdbRoutes")
);

const importRoutes =
  require("./routes/importRoutes");

const tvTimeImportRoutes = require(
  "./routes/tvTimeImportRoutes"
);

app.use(
  "/api/import",
  importRoutes
);

app.use(
  "/api/letterboxd",
  importRoutes
);

app.use(
  "/api/tv-time-import",
  tvTimeImportRoutes
);

/*
 * Scene News Generator is intentionally disabled.
 *
 * There is:
 * - no node-cron import
 * - no socialNewsGenerator import
 * - no /api/social-news route
 * - no startup generation
 * - no scheduled generation
 */
app.use(
  "/api",
  require("./routes/sceneShim")
);

// ============================================================
// SOCKET.IO
// ============================================================

const io = new Server(
  server,
  {
    cors: {
      origin(
        origin,
        callback
      ) {
        if (
          isAllowedOrigin(origin)
        ) {
          return callback(
            null,
            true
          );
        }

        return callback(
          new Error(
            "Not allowed by Socket.IO CORS"
          )
        );
      },

      methods: [
        "GET",
        "POST",
      ],

      credentials:
        true,
    },
  }
);

/*
 * Register Socket.IO in the standalone singleton.
 *
 * sendNotification.js calls getIO(), which avoids importing
 * server.js and prevents a circular dependency.
 */
setIO(io);

// Retained for any existing routes/controllers using req.app.get("io").
app.set(
  "io",
  io
);

// ============================================================
// SOCKET.IO AUTHENTICATION
// ============================================================

io.use(
  async (
    socket,
    next
  ) => {
    try {
      const authorizationHeader =
        socket.handshake
          .headers
          ?.authorization;

      const handshakeToken =
        socket.handshake
          .auth
          ?.token;

      const rawToken =
        handshakeToken ||
        (
          typeof authorizationHeader ===
            "string" &&
          authorizationHeader.startsWith(
            "Bearer "
          )
            ? authorizationHeader.slice(
                7
              )
            : null
        );

      if (!rawToken) {
        return next(
          new Error(
            "Authentication required"
          )
        );
      }

      if (
        !process.env.JWT_SECRET
      ) {
        return next(
          new Error(
            "Authentication unavailable"
          )
        );
      }

      const decoded =
        jwt.verify(
          rawToken,
          process.env.JWT_SECRET,
          {
            algorithms: [
              "HS256",
            ],
          }
        );

      const userId =
        decoded.id;

      const sessionId =
        decoded.sid;

      if (
        !userId ||
        !sessionId
      ) {
        return next(
          new Error(
            "Invalid authentication token"
          )
        );
      }

      if (
        mongoose.connection
          .readyState !== 1
      ) {
        return next(
          new Error(
            "Database temporarily unavailable"
          )
        );
      }

      const session =
        await Session.findOne({
          _id:
            sessionId,

          user:
            userId,

          revokedAt:
            null,

          expiresAt: {
            $gt:
              new Date(),
          },
        }).select(
          "_id user"
        );

      if (!session) {
        return next(
          new Error(
            "Session expired or revoked"
          )
        );
      }

      socket.userId =
        String(userId);

      socket.sessionId =
        String(sessionId);

      return next();
    } catch (error) {
      console.warn(
        "⚠️ Socket authentication rejected:",
        error?.message ||
          error
      );

      return next(
        new Error(
          "Invalid authentication token"
        )
      );
    }
  }
);

io.on(
  "connection",
  (socket) => {
    /*
     * The server decides the room.
     * Clients cannot join arbitrary user-ID rooms.
     */
    socket.join(
      socket.userId
    );

    console.log(
      `🔌 Socket connected for user ${socket.userId}`
    );

    socket.on(
      "disconnect",
      (reason) => {
        console.log(
          `🔌 Socket disconnected for user ${socket.userId}. Reason: ${reason}`
        );
      }
    );
  }
);

// ============================================================
// MONGOOSE EVENTS
// ============================================================

mongoose.connection.on(
  "connected",
  () => {
    console.log(
      "✅ MongoDB connected/reconnected"
    );
  }
);

mongoose.connection.on(
  "disconnected",
  () => {
    console.warn(
      "⚠️ MongoDB disconnected"
    );

    if (
      !mongoConnectInProgress
    ) {
      connectWithRetry();
    }
  }
);

mongoose.connection.on(
  "error",
  (error) => {
    console.error(
      "❌ MongoDB error:",
      error.code ||
        error.message ||
        error
    );
  }
);

// ============================================================
// 404 AND ERROR HANDLING
// ============================================================

app.use(
  (req, res) => {
    return res
      .status(404)
      .json({
        message:
          "Not Found",

        path:
          req.originalUrl,
      });
  }
);

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "💥 Unhandled request error:",
      {
        method:
          req.method,

        url:
          req.originalUrl,

        message:
          error.message,
      }
    );

    if (
      res.headersSent
    ) {
      return next(error);
    }

    return res
      .status(
        error.status ||
          500
      )
      .json({
        error:
          error.status &&
          error.status < 500
            ? error.message
            : "Internal Server Error",
      });
  }
);

// ============================================================
// START SERVER
// ============================================================

server.listen(
  PORT,
  () => {
    console.warn(
      `🚀 Scene backend and Socket.IO running on port ${PORT}`
    );

    console.warn(
      "🛑 Scene News Generator is disabled"
    );
  }
);

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

let shutdownStarted = false;

async function shutdown(
  signal
) {
  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;

  console.warn(
    `🛑 Received ${signal}. Shutting down...`
  );

  clearTimeout(
    mongoRetryTimer
  );

  try {
    io.close();
  } catch (error) {
    console.error(
      "Socket.IO shutdown error:",
      error.message
    );
  }

  server.close(
    async () => {
      try {
        await mongoose.connection.close();
      } catch (error) {
        console.error(
          "Mongo shutdown error:",
          error.message
        );
      }

      process.exit(0);
    }
  );

  setTimeout(
    () => {
      console.error(
        "❌ Graceful shutdown timed out"
      );

      process.exit(1);
    },
    10000
  ).unref();
}

process.on(
  "SIGTERM",
  () =>
    shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () =>
    shutdown("SIGINT")
);

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  app,
  io,
  server,
};

