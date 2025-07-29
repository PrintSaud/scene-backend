const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();
mongoose.set('debug', true);

console.log("🧪 ENV CHECK — DB_URI:", process.env.DB_URI);
console.log("🧪 ENV CHECK — JWT_SECRET:", process.env.JWT_SECRET);
console.log("🧪 ENV CHECK — TMDB_KEY:", process.env.TMDB_API_KEY);


const app = express();

// 1️⃣ Middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://scene-frontend-production.up.railway.app",
    ],
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"], // ✅ added PUT
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);


app.options("*", cors({
  origin: [
    "http://localhost:5173",
    "https://scene-frontend-production.up.railway.app",
  ],
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE"], // ✅ added PUT
  allowedHeaders: ["Content-Type", "Authorization"],
}));


// 🔔 DO NOT register express.json() globally here!
// app.use(express.json());

app.use(express.static("public"));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// 2️⃣ MongoDB connection
const DB_URI = process.env.DB_URI;
if (!DB_URI) {
  console.error("❌ MISSING DB_URI — check Railway Environment Variables");
} else if (!DB_URI.includes("scene")) {
  console.warn("⚠️ DB_URI doesn’t look like your Scene DB. Proceeding anyway.");
}

mongoose
  .connect(DB_URI)
  .then(() => {
    console.log(`✅ MongoDB connected to: ${mongoose.connection.name}`);
  })  
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

// 3️⃣ Routes — express.json() only for JSON-based routes
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
const tmdbRoutes = require("./routes/tmdbRoutes");
app.use("/api/tmdb", tmdbRoutes);
const importRoutes = require('./routes/importRoutes');
app.use('/api/import', importRoutes);
app.use('/api/letterboxd', importRoutes); // ✅ add this
app.use("/api/logs", express.json(), require("./routes/Logs")); // ✅ now JSON body works
const posterRoutes = require("./routes/posterRoutes");
app.use("/api/posters", posterRoutes);


// 4️⃣ Health check
app.get("/", (req, res) => {
  res.send("Root route is working!");
});

// 5️⃣ Socket.IO setup
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "https://scene-frontend-production.up.railway.app",
    ],
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  },
});

// 💥 Make io accessible in routes
app.set("io", io);

io.on("connection", (socket) => {
  console.log("⚡ New client connected:", socket.id);

  socket.on("join", (userId) => {
    socket.join(userId);
    console.log(`🟢 User ${userId} joined room`);
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);
  });
});


// 6️⃣ Start server
const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log(`🚀 Server + Socket.IO running on port ${PORT}`);
});

module.exports = app;
