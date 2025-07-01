
const express = require('express');
const router = express.Router(); // 🔥 THIS is what’s missing
const Poll = require('../models/poll');


router.post('/', async (req, res) => {
    const { question, options, createdBy } = req.body;
    try {
      const poll = await Poll.create({ question, options, createdBy });
      res.status(201).json(poll);
    } catch (err) {
      res.status(500).json({ message: 'Error creating poll', error: err.message });
    }
  });
  router.post('/:id/vote', async (req, res) => {
    const { userId, optionIndex } = req.body;
    try {
      const poll = await Poll.findById(req.params.id);
      poll.votes.push({ userId, optionIndex });
      await poll.save();
      res.status(200).json({ message: 'Vote submitted' });
    } catch (err) {
      res.status(500).json({ message: 'Error voting', error: err.message });
    }
  });
  router.post('/:id/reply', async (req, res) => {
    const { userId, text } = req.body;
    try {
      const poll = await Poll.findById(req.params.id);
      poll.replies.push({ userId, text });
      await poll.save();
      res.status(200).json({ message: 'Reply added' });
    } catch (err) {
      res.status(500).json({ message: 'Error replying', error: err.message });
    }
  });
  router.get('/', async (req, res) => {
    const polls = await Poll.find().sort({ createdAt: -1 });
    res.status(200).json(polls);
  });

  module.exports = router;
