require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sceneShimRouter = require("./src/routes/sceneShim");

const app = express();

app.use(express.json());
app.use(cors());

// Routes
app.use("/api", sceneShimRouter);

app.get('/', (req, res) => {
  res.send('Flick Backend is running!');
});

module.exports = app;

