// 🌍 0️⃣ Load environment first
require("dotenv").config();

// // 🔇 Silence noisy logs in production (keep warn/error)
// if (process.env.NODE_ENV === "production") {
//  console.log = () => {};
 // console.info = () => {};
//  console.debug = () => {};
// }

// 📦 Imports
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const sceneBotRouter = require("./routes/sceneBot");
// 🐛 Mongoose debug only in development
mongoose.set("debug", process.env.NODE_ENV !== "production");

const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

app.set("firebaseAdmin", admin);


// 🛡 Mask sensitive values in logs
const mask = (v) => (v ? v.slice(0, 4) + "•••" + v.slice(-4) : "(empty)");
console.warn("🧪 ENV — NODE_ENV:", process.env.NODE_ENV);
console.warn("🧪 ENV — DB_URI:", process.env.DB_URI ? "set" : "missing");
console.warn("🧪 ENV — JWT_SECRET:", mask(process.env.JWT_SECRET));
console.warn("🧪 ENV — TMDB_KEY:", mask(process.env.TMDB_API_KEY));

// 🧭 Allowed origins
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

ORIGINS.push("https://expo"); // add this during dev/testing

const app = express();
app.set("trust proxy", 1);

// 🔐 1️⃣ CORS Setup
const corsOptions = {
  origin(origin, callback) {
    // Allow requests with no origin (e.g. server-to-server, curl)
    if (!origin) return callback(null, true);

    // Allow exact whitelisted origins
    if (allowedOrigins.has(origin)) return callback(null, true);

    // Allow subdomains of scenesa.com
    const sub = /^https?:\/\/([a-z0-9-]+\.)*scenesa\.com$/i;
    if (sub.test(origin)) return callback(null, true);

    // DEV: allow Expo dev clients / urls
    // - The Expo dev client sometimes uses "https://expo" as origin
    // - Local expo tunnels may use exp:// or http://localhost with different ports
    if (origin.startsWith("https://expo") || origin.startsWith("exp://") || origin.startsWith("http://localhost:")) {
      return callback(null, true);
    }

    // Otherwise reject
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));


// 2️⃣ OG routes FIRST (important for crawlers)
const ogRoutes = require("./routes/ogRoutes");
app.use("/", ogRoutes);

// 3️⃣ Static files
app.use(express.static("public"));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// 🔌 4️⃣ MongoDB connection
const DB_URI = process.env.DB_URI;
const mongoOpts = { serverSelectionTimeoutMS: 15000, family: 4 };
async function connectWithRetry(attempt = 1) {
  try {
    await mongoose.connect(DB_URI, mongoOpts);
    console.warn(`✅ MongoDB connected to: ${mongoose.connection.name}`);
  } catch (err) {
    console.error(`❌ MongoDB connect failed (attempt ${attempt}):`, err.code || err.message);
    const backoff = Math.min(30000, attempt * 3000);
    setTimeout(() => connectWithRetry(attempt + 1), backoff);
  }
}
connectWithRetry();

// 🔒 Gate requests until Mongo ready
function requireDbReady(req, res, next) {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database not connected yet" });
  }
  next();
}

// -----------------------------
// REVIEW: tryAuthOrBypass middleware
// -----------------------------
/**
 * Tries to run your normal protect middleware. If protect sets req.user -> OK.
 * If protect rejects (missing/invalid token), we DO NOT return 401; instead
 * we set a lightweight bypass user on req.user so the app can proceed.
 *
 * ONLY mount this on endpoints you want to allow review access to.
 */
function tryAuthOrBypass(req, res, next) {
  // If a valid Authorization header exists, run protect normally.
  const authHeader = req.headers.authorization || "";

  // If there's clearly *no* Authorization header, we can short-circuit to bypass immediately.
  // (This avoids protect raising "jwt malformed" on empty header strings.)
  if (!authHeader || authHeader.trim() === "") {
    req.user = { _id: "scene-bot-user", username: "Bypass User", isReviewBypass: true };
    return next();
  }

  // If header exists, attempt normal protect but catch errors.
  try {
    // protect expects (req, res, next) and will call next() to continue.
    protect(req, res, () => {
      // protect finished successfully and should set req.user
      if (req.user) return next();
      // protect didn't set a user (rare), fallback to bypass
      req.user = { _id: "scene-bot-user", username: "Bypass User", isReviewBypass: true };
      return next();
    });
  } catch (err) {
    // If protect throws synchronously for some reason, fallback to bypass user
    console.warn("🟡 tryAuthOrBypass: protect threw — falling back to bypass user:", err?.message);
    req.user = { _id: "scene-bot-user", username: "Bypass User", isReviewBypass: true };
    return next();
  }
}


// -----------------------------
// TEMP: Catch /api/scenebot and proxy it to /api/scene-bot with injected secret
// Place this HIGH in server.js after `const app = express()` and before other /api mounts.
// -----------------------------
const rateMap = new Map();
const BYPASS_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const BYPASS_LIMIT_MAX = 60; // adjust lower if you want stricter protection

function bypassRateAllow(ip) {
  const now = Date.now();
  let rec = rateMap.get(ip);
  if (!rec) {
    rec = { count: 1, resetAt: now + BYPASS_LIMIT_WINDOW_MS };
    rateMap.set(ip, rec);
    return true;
  }
  if (now > rec.resetAt) {
    rec.count = 1;
    rec.resetAt = now + BYPASS_LIMIT_WINDOW_MS;
    rateMap.set(ip, rec);
    return true;
  }
  if (rec.count >= BYPASS_LIMIT_MAX) return false;
  rec.count += 1;
  rateMap.set(ip, rec);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of rateMap.entries()) {
    if (now > rec.resetAt + 5 * 60 * 1000) rateMap.delete(ip);
  }
}, 10 * 60 * 1000);

app.post("/api/scenebot", express.json(), async (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress || "unknown";
    const origin = req.headers.origin || "";
    console.log("🔥 SceneBot proxy hit (/api/scenebot) IP:", ip, "origin:", origin, "body:", req.body);

    if (!bypassRateAllow(ip)) {
      console.warn("⚠️ SceneBot bypass rate limit exceeded for IP:", ip);
      return res.status(429).json({ error: "Too many requests. Try again later." });
    }

    // If body missing, ensure a safe fallback so /api/scene-bot always gets a message
    const outgoingBody = (req.body && typeof req.body === "object" && Object.keys(req.body).length)
      ? req.body
      : { message: "Hello" };

    // Use your secret so the inner route treats this as a bypass user
    const secret = process.env.SCENEBOT_SECRET || "supersecretstring123";

    // Use internal URL: if your server can call itself via localhost you can use that for speed:
    // const internalBase = process.env.INTERNAL_BACKEND_URL || `http://localhost:${process.env.PORT || 8080}`;
    // However many deployments (Railway etc.) won't accept calling localhost; use the public hostname instead:
    const internalBase = process.env.INTERNAL_BACKEND_URL || `https://backend.scenesa.com`;

    const proxyRes = await fetch(`${internalBase}/api/scene-bot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${secret}`,
      },
      body: JSON.stringify(outgoingBody),
    });

    const ct = proxyRes.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const json = await proxyRes.json().catch(() => ({ error: "invalid json from internal" }));
      return res.status(proxyRes.status).json(json);
    } else {
      const txt = await proxyRes.text().catch(() => "");
      return res.status(proxyRes.status).send(txt);
    }
  } catch (err) {
    console.error("❌ SceneBot bypass proxy error:", err);
    return res.status(500).json({ message: "SceneBot is temporarily unavailable. Please try again later." });
  }
});


app.use("/api", requireDbReady);

 

app.use((req, res, next) => {
  console.log("🔥 Incoming request:", req.method, req.originalUrl);
  next();
});

app.use("/api/scenebot", (req, res, next) => {
  console.log("🔥 SceneBot proxy hit from old frontend:", req.method, req.originalUrl);
  next();
});

app.use((req, res, next) => {
  console.log("🔥 Incoming request:", req.method, req.originalUrl, "body:", req.body);
  next();
});

// 🟡 TEMP: Support old frontend calls that hit /api/scenebot without token
app.post("/api/scenebot", express.json(), async (req, res) => {
  console.log("🔥 SceneBot proxy hit from old frontend:", req.method, req.originalUrl);
  console.log("🔥 Incoming request body:", req.body);

  try {
    const response = await fetch(`${process.env.BACKEND_URL || "https://backend.scenesa.com"}/api/scene-bot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.SCENEBOT_SECRET || "supersecretstring123"}`
      },
      body: JSON.stringify(req.body || {}),
    });

    const data = await response.json();
    console.log("🔥 SceneBot proxy success ->", data);
    return res.json(data);
  } catch (err) {
    console.error("❌ SceneBot proxy error:", err);
    res.status(500).json({ message: "SceneBot is currently unavailable. Please try again later." });
  }
});


// 5️⃣ API routes
app.use("/api/auth", express.json(), require("./routes/auth"));
app.use("/api/upload", express.json(), require("./routes/upload"));

app.use("/api/users", express.json(), tryAuthOrBypass, require("./routes/user"));
app.use("/api/logs", express.json(), tryAuthOrBypass, require("./routes/logRoutes"));
app.use("/api/watchlist", express.json(), tryAuthOrBypass, require("./routes/watchlistRoutes"));

app.use("/api/lists", express.json(), tryAuthOrBypass,  require("./routes/listRoutes"));
app.use("/api/polls", express.json(), require("./routes/poll"));
app.use("/api/notifications", express.json(), tryAuthOrBypass,  require("./routes/notification"));
app.use("/api/search", express.json(), require("./routes/search"));
app.use("/api/ai", express.json(), require("./routes/ai"));
app.use("/api/home", express.json(), tryAuthOrBypass, require("./routes/home"));
app.use("/api/movies", express.json(),tryAuthOrBypass,  require("./routes/movieRoutes"));

app.use("/api/scene-bot", express.json(), sceneBotRouter); // existing
app.use("/api/scenebot", express.json(), sceneBotRouter);  // catch old frontend

app.use("/api/posters", express.json(), require("./routes/posterRoutes"));
app.use("/api/movies/daily", express.json(), tryAuthOrBypass,  require("./routes/dailyMovie"));
app.use("/api/tmdb", require("./routes/tmdbRoutes"));
const importRoutes = require("./routes/importRoutes");
app.use("/api/import", importRoutes);
app.use("/api/letterboxd", importRoutes);
// near other route imports
const sceneShim = require('./routes/sceneShim');
app.use('/api', sceneShim);

// 💓 Health check
app.get("/health", (req, res) => res.json({ ok: true }));

// 🧠 6️⃣ Socket.IO setup
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allowedOrigins.has(origin)) return cb(null, true);
      const sub = /^https?:\/\/([a-z0-9-]+\.)*scenesa\.com$/i;
      if (sub.test(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS (ws)"));
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});
app.set("io", io);
io.on("connection", (socket) => {
  socket.on("join", (userId) => socket.join(userId));
});

// SceneBot health
app.get("/api/scene-bot/health", (req, res) => {
  res.json({ ok: true, message: "SceneBot is live" });
});


// 7️⃣ SPA fallback — after OG + API
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.resolve(__dirname, "../dist/index.html"));
});



// ❌ Error handlers
app.use((req, res) => res.status(404).json({ message: "Not Found", path: req.originalUrl }));
app.use((err, req, res, next) => {
  console.error("💥 Unhandled error:", { url: req.originalUrl, message: err.message });
  res.status(err.status || 500).json({ error: err.message || "Internal Server Error" });
});

// 🚀 Start
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
