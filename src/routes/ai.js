const express = require('express');
const router = express.Router();

// Mocked AI response (for now)
router.post('/chat', async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ reply: 'Message is required.' });
  }

  // TODO: Replace this with real AI later
  const replies = [
    "That's a great pick!",
    "Have you seen Interstellar?",
    "I’d recommend something like Parasite tonight.",
    "You're gonna love that movie!",
    "Great question — let me think..."
  ];
  const randomReply = replies[Math.floor(Math.random() * replies.length)];

  res.status(200).json({ reply: randomReply });
});

module.exports = router;
