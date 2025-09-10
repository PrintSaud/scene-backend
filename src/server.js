// 🌍 0️⃣ Load environment first
require("dotenv").config();

// 🔇 Silence noisy logs in production (keep warn/error)
if (process.env.NODE_ENV === "production") {
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
}

// 📦 Imports
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

// 🐛 Mongoose debug only in development
mongoose.set("debug", process.env.NODE_ENV !== "production");

// 🛡 Mask sensitive values in logs
const mask = (v) => (v ? v.slice(0, 4) + "•••" + v.slice(-4) : "(empty)");
console.warn("🧪 ENV — NODE_ENV:", process.env.NODE_ENV);
console.warn("🧪 ENV — DB_URI:", process.env.DB_URI ? "set" : "missing");
console.warn("🧪 ENV — JWT_SECRET:", mask(process.env.JWT_SECRET));
console.warn("🧪 ENV — TMDB_KEY:", mask(process.env.TMDB_API_KEY));

// 🧭 Build allowed origins from env (comma-separated)
const DEFAULT_ORIGINS = [
  "http://localhost:5173",
  "https://scene-frontend-production.up.railway.app",
  "https://scenesa.com",
  "https://www.scenesa.com",
];
const ORIGINS = (process.env.FRONTEND_ORIGINS || DEFAULT_ORIGINS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const allowedOrigins = new Set(ORIGINS);

const app = express();

// If behind a proxy (Railway/NGINX), enable trust proxy for cookies/IP
app.set("trust proxy", 1);

// 🔐 1️⃣ CORS Setup — placed early
const corsOptions = {
  origin(origin, callback) {
    // allow non-browser/undefined origins (mobile apps, curl, SSR)
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);

    // Optional: allow any subdomain of scenesa.com
    const scenesaSubdomain = /^https?:\/\/([a-z0-9-]+\.)*scenesa\.com$/i;
    if (scenesaSubdomain.test(origin)) return callback(null, true);

    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // 🌐 Preflight

// 📁 2️⃣ Static files
app.use(express.static("public"));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// 🔌 3️⃣ MongoDB connection (robust on flaky DNS)
const DB_URI = process.env.DB_URI;
if (!DB_URI) {
  console.error("❌ MISSING DB_URI — check Environment Variables");
} else if (!/mongodb(\+srv)?:\/\//.test(DB_URI)) {
  console.warn("⚠️ DB_URI format unexpected. Proceeding anyway.");
}

const mongoOpts = {
  serverSelectionTimeoutMS: 15000, // don't hang forever
  family: 4, // force IPv4 to avoid SRV/TXT hiccups (not a LAN IP; safe to keep)
};

async function connectWithRetry(attempt = 1) {
  try {
    await mongoose.connect(DB_URI, mongoOpts);
    console.warn(`✅ MongoDB connected to: ${mongoose.connection.name}`);
  } catch (err) {
    console.error(
      `❌ MongoDB connect failed (attempt ${attempt}):`,
      err.code || err.message
    );
    const backoff = Math.min(30000, attempt * 3000);
    setTimeout(() => connectWithRetry(attempt + 1), backoff);
  }
}
connectWithRetry();

// 🔒 Gate requests until Mongo is ready (only for API paths)
function requireDbReady(req, res, next) {
  const ready = mongoose.connection.readyState === 1; // 1 = connected
  if (!ready) return res.status(503).json({ error: "Database not connected yet" });
  next();
}
app.use("/api", requireDbReady);

// 🛣️ 4️⃣ Routes (use express.json per group)
const ogRoutes = require("./routes/ogRoutes");
app.use("/", ogRoutes);
app.use("/api/auth", express.json(), require("./routes/auth"));
app.use("/api/users", express.json(), require("./routes/user"));
app.use("/api/upload", express.json(), require("./routes/upload"));
app.use("/api/watchlist", express.json(), require("./routes/watchlistRoutes"));
app.use("/api/lists", express.json(), require("./routes/listRoutes"));
app.use("/api/polls", express.json(), require("./routes/poll"));
app.use("/api/notifications", express.json(), require("./routes/notification"));
app.use("/api/search", express.json(), require("./routes/search"));
app.use("/api/ai", express.json(), require("./routes/ai"));
app.use("/api/home", express.json(), require("./routes/home"));
app.use("/api/movies", express.json(), require("./routes/movieRoutes"));
app.use("/api/scenebot", express.json(), require("./routes/sceneBot"));
app.use("/api/posters", express.json(), require("./routes/posterRoutes"));
app.use("/api/movies/daily", express.json(), require("./routes/dailyMovie"));
app.use("/api/logs", express.json(), require("./routes/logRoutes"));
app.use("/api/tmdb", require("./routes/tmdbRoutes"));
const importRoutes = require("./routes/importRoutes");
app.use("/api/import", importRoutes);
app.use("/api/letterboxd", importRoutes);

// 💓 5️⃣ Health check
app.get("/", (req, res) => res.send("Root route is working!"));

// 🧠 6️⃣ Socket.IO setup (mirror CORS)
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      const scenesaSubdomain = /^https?:\/\/([a-z0-9-]+\.)*scenesa\.com$/i;
      if (scenesaSubdomain.test(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS (ws)"));
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});
app.set("io", io);

// Global Socket.IO error logging
io.engine.on("connection_error", (err) => {
  console.error("🚨 Socket.IO CORS connection error:", err.message);
});
io.on("connection", (socket) => {
  socket.on("join", (userId) => socket.join(userId));
  socket.on("disconnect", () => {});
});

// 404 (keep it simple so we see real 404s during debugging)
app.use((req, res) => {
  res.status(404).json({ message: "Not Found", path: req.originalUrl });
});

// Central error handler (shows full details in console)
app.use((err, req, res, next) => {
  console.error("💥 Unhandled error:", {
    method: err?.method || req.method,
    url: err?.url || req.originalUrl,
    message: err.message,
    stack: err.stack,
  });
  res.status(err.status || 500).json({ error: err.message || "Internal Server Error" });
});

// 🚀 7️⃣ Start server AFTER Mongo connects; also watch for disconnects
const PORT = process.env.PORT || 8080;

mongoose.connection.once("connected", () => {
  server.listen(PORT, () => {
    console.warn(`🚀 Server + Socket.IO running on port ${PORT}`);
  });
});

mongoose.connection.on("error", (err) => {
  console.error("❌ Mongo connection error:", err?.code || err?.message || err);
});

mongoose.connection.on("disconnected", () => {
  console.error("⚠️ Mongo disconnected");
});

module.exports = app;
