// src/App.js
import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);
const express = require('express');
const cors = require("cors");

app.use(cors({
  origin: "http://localhost:5173",
  credentials: true // optional if you’ll use cookies later
}));

const app = express();

app.use(cors());
app.use(express.json());
function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* Add more routes here like signup, home etc */}
      </Routes>
    </Router>
  );
}

export default App;
