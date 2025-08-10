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

const app = express();

// 🔐 1️⃣ CORS Setup — placed early
const allowedOrigins = [
  "http://localhost:5173",
  "https://scene-frontend-production.up.railway.app",
  "https://scenesa.com",
  "https://www.scenesa.com",
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// 🌐 1.5 Handle all OPTIONS requests for CORS preflight
app.options("*", (req, res) => res.sendStatus(200));

// 📁 2️⃣ Static files
app.use(express.static("public"));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// 🔌 3️⃣ MongoDB connection
const DB_URI = process.env.DB_URI;
if (!DB_URI) {
  console.error("❌ MISSING DB_URI — check Railway Environment Variables");
} else if (!DB_URI.includes("scene")) {
  console.warn("⚠️ DB_URI doesn’t look like your Scene DB. Proceeding anyway.");
}

mongoose
  .connect(DB_URI)
  .then(() => console.warn(`✅ MongoDB connected to: ${mongoose.connection.name}`))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

// 🛣️ 4️⃣ Routes (use express.json per group to avoid unnecessary parsing)
const ogRoutes = require("./routes/ogRoutes");
app.use("/og", ogRoutes);
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

// 🧠 6️⃣ Socket.IO setup
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
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

// 🚀 7️⃣ Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.warn(`🚀 Server + Socket.IO running on port ${PORT}`);
});

module.exports = app;
