const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const os = require("os");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();

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
const DB_URI = process.env.DB_URI || "mongodb://localhost:27017/flick";
mongoose
  .connect(DB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

// 3. Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/user")); // 👈 this includes /gif/recent and /:id/recent-gifs
app.use("/api/upload", require("./routes/upload"));
app.use("/api/watchlist", require("./routes/watchlistRoutes")); // 🧹 merged clean path
app.use("/api/logs", require("./routes/Logs"));
app.use("/api/lists", require("./routes/listRoutes"));
app.use("/api/polls", require("./routes/poll"));
app.use("/api/notifications", require("./routes/notification"));
app.use("/api/search", require("./routes/search"));
app.use("/api/ai", require("./routes/ai"));
app.use("/api/home", require("./routes/home"));
app.use("/api/movies", require("./routes/movieRoutes"));
app.use("/api/scenebot", require("./routes/sceneBot"));
app.use("/api/posters", require("./routes/posterRoutes"));

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

module.exports = server;


// 6. Start server
const PORT = process.env.PORT || 4000;
const networkInterfaces = os.networkInterfaces();
const localIP =
  Object.values(networkInterfaces)
    .flat()
    .find((iface) => iface.family === "IPv4" && !iface.internal)?.address || "localhost";

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server + Socket.IO running at http://${localIP}:${PORT}`);
});
