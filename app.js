const express = require('express');  
const cors = require('cors');  

const app = express();  

// Middlewares  
app.use(express.json());  
app.use(cors());  

// Test Route  
app.get('/', (req, res) => {  
  res.send('Flick Backend is running!');  
});  

module.exports = app;
