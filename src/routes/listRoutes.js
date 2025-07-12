const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const protectOptional = require("../middleware/protectOptional");
const List = require("../models/list");
const User = require("../models/user");

// ✅ Get popular public lists (Popular tab)
router.get("/popular", async (req, res) => {
  try {
    const lists = await List.find({ isPrivate: false })
      .sort({ likes: -1 })
      .limit(50)
      .populate("user", "username avatar");
    res.json(lists);
  } catch (err) {
    res.status(500).json({ message: "❌ Failed to fetch popular lists", error: err });
  }
});

// ✅ Friends’ Lists
router.get("/friends", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const followingIds = user.following || [];
    const lists = await List.find({
      user: { $in: followingIds },
      isPrivate: false,
    }).populate("user", "username avatar");

    res.json(lists);
  } catch (err) {
    console.error("🔥 Failed to fetch friends' lists:", err);
    res.status(500).json({ message: "❌ Failed to fetch friends' lists", error: err.message });
  }
});

// ✅ Create a new list
router.post("/", protect, async (req, res) => {
  try {
    const list = await List.create({
      user: req.user._id,
      title: req.body.title,
      description: req.body.description || "",
      coverImage: req.body.coverImage || "",
      isPrivate: req.body.isPrivate || false,
      isRanked: req.body.isRanked || false,
      movies: req.body.movies || [],
    });
    res.status(201).json(list);
  } catch (err) {
    res.status(500).json({ message: "❌ Failed to create list", error: err });
  }
});

// ✅ My Lists
router.get("/my", protect, async (req, res) => {
  try {
    const lists = await List.find({ user: req.user._id }).populate("user", "username avatar");
    res.json(lists);
  } catch (err) {
    res.status(500).json({ message: "❌ Failed to fetch my lists", error: err.message });
  }
});

// ✅ Get lists by user
router.get("/user/:userId", protectOptional, async (req, res) => {
  try {
    const isOwner = req.user && req.user._id.toString() === req.params.userId;
    const filter = isOwner
      ? { user: req.params.userId }
      : { user: req.params.userId, isPrivate: false };
    const lists = await List.find(filter).populate("user", "username avatar");
    res.json(lists);
  } catch (err) {
    res.status(500).json({ message: "❌ Failed to get user lists", error: err });
  }
});

// ✅ Saved Lists
router.get("/saved", protect, async (req, res) => {
  try {
    const lists = await List.find({ savedBy: req.user._id }).populate("user", "username avatar");
    res.json(lists);
  } catch (err) {
    res.status(500).json({ message: "❌ Failed to get saved lists", error: err });
  }
});

// ✅ Single List View
router.get("/:id", async (req, res) => {
  try {
    const list = await List.findById(req.params.id)
      .populate("user", "username avatar")
      .populate("movies");
    if (!list) return res.status(404).json({ message: "List not found" });

    // 🛠️ Build movies array with posterOverride attached properly
    const moviesWithOverride = list.movies.map((movie) => {
      return {
        ...movie.toObject(),
        posterOverride: movie.poster || null,  // if poster is your override
      };
    });

    const result = {
      ...list.toObject(),
      movies: moviesWithOverride,
    };

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "❌ Failed to fetch list", error: err });
  }
});


// ✅ Like / Unlike
router.post("/:id/like", protect, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ message: "List not found" });

    const userId = req.user._id.toString();
    const liked = list.likes.includes(userId);
    list.likes = liked
      ? list.likes.filter((id) => id.toString() !== userId)
      : [...list.likes, userId];

    await list.save();
    res.json({ liked: !liked, likesCount: list.likes.length });
  } catch (err) {
    res.status(500).json({ message: "❌ Failed to like list", error: err.message });
  }
});

// ✅ Save / Unsave
router.post("/:id/save", protect, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ message: "List not found" });

    const index = list.savedBy.indexOf(req.user._id);
    if (index === -1) {
      list.savedBy.push(req.user._id);
    } else {
      list.savedBy.splice(index, 1);
    }

    await list.save();
    res.json({ saved: index === -1 });
  } catch (err) {
    res.status(500).json({ message: "❌ Failed to save list", error: err });
  }
});

// ✅ Edit List
router.patch("/:id", protect, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ message: "List not found" });
    if (!list.user.equals(req.user._id)) return res.status(403).json({ message: "Unauthorized" });

    list.title = req.body.title || list.title;
    list.description = req.body.description || list.description;
    list.coverImage = req.body.coverImage || list.coverImage;
    list.isPrivate = req.body.isPrivate ?? list.isPrivate;
    list.isRanked = req.body.isRanked ?? list.isRanked;
    list.movies = req.body.movies || list.movies;

    const updated = await list.save();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: "❌ Failed to update list", error: err });
  }
});

// ✅ Delete List
router.delete("/:id", protect, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ message: "List not found" });
    if (!list.user.equals(req.user._id)) return res.status(403).json({ message: "Unauthorized" });

    await list.deleteOne();
    res.json({ message: "✅ List deleted" });
  } catch (err) {
    res.status(500).json({ message: "❌ Failed to delete list", error: err });
  }
});

// ✅ Add Movie to List
router.post("/:id/add", protect, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ message: "List not found" });
    if (!list.user.equals(req.user._id)) return res.status(403).json({ message: "Unauthorized" });

    const { id, title, poster } = req.body;
    if (!id || !title) return res.status(400).json({ message: "Missing movie id or title" });

    const exists = list.movies.some((m) => m.id === id);
    if (exists) return res.status(409).json({ message: "Movie already in list" });

    list.movies.push({ id, title, poster });
    await list.save();
    res.json({ message: "✅ Movie added", list });
  } catch (err) {
    res.status(500).json({ message: "❌ Failed to add movie", error: err.message });
  }
});

module.exports = router;
