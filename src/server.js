const express = require("express");
const mongoose = require("mongoose");
const originalConnect = mongoose.connect;

const cors = require("cors");
const path = require("path");
const os = require("os");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();
mongoose.set('debug', true); // 🔍 log all queries
console.log("🧪 ENV CHECK — DB_URI:", process.env.DB_URI);

const app = express();

// 1. Middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://scene-frontend-production.up.railway.app",
    ],
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
  })
);

app.use(express.json());
app.use(express.static("public"));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// 2. Connect to MongoDB
const DB_URI = process.env.DB_URI;
if (!DB_URI || !DB_URI.includes("scene")) {
  console.error("❌ Invalid or missing DB_URI. Exiting...");
  process.exit(1);
}

console.log("🧪 ENV CHECK — DB_URI:", process.env.DB_URI);



if (!DB_URI) {
  console.error("❌ DB_URI is missing from environment variables!");
  process.exit(1); // Hard exit if not provided
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

// 3. Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/user")); 
app.use("/api/upload", require("./routes/upload"));
app.use('/api/watchlist', require('./routes/watchlistRoutes'));
app.use("/api/logs", require("./routes/Logs"));
app.use("/api/lists", require("./routes/listRoutes"));
app.use("/api/polls", require("./routes/poll"));
app.use("/api/notifications", require("./routes/notification"));
app.use("/api/search", require("./routes/search"));
app.use("/api/ai", require("./routes/ai"));
app.use("/api/home", require("./routes/home"));
app.use("/api/movies", require("./routes/movieRoutes"));
app.use("/api/scenebot", require("./routes/sceneBot"));
app.use("/api/posters", require("./routes/posterRoutes")); // ✅ now it works

app.use("/api/movies/daily", require("./routes/dailyMovie"));
// 4. Health check
app.get("/", (req, res) => {
  res.send("Root route is working!");
});

// 5. Socket.IO setup
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "https://scene-frontend-production.up.railway.app",
    ],
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
  },
});

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

// 6. Start server
const PORT = process.env.PORT;
if (!PORT) {
  console.error("❌ No PORT provided by Railway. Exiting...");
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(`🚀 Server + Socket.IO running on port ${PORT}`);
});


// 👇 Export Express app so Railway knows it's alive

module.exports = app;
