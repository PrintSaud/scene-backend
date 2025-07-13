const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const protectOptional = require("../middleware/protectOptional");
const List = require("../models/list");
const User = require("../models/user");
const CustomPoster = require("../models/customPoster"); // ✅ Ensure this is imported
const axios = require("axios"); // ✅ add at the top if not already present
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";
const TMDB_API_KEY = process.env.TMDB_API_KEY;

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

// ✅ Saved Lists
router.get("/saved", protect, async (req, res) => {
  try {
    const lists = await List.find({ savedBy: req.user._id }).populate("user", "username avatar");
    res.json(lists);
  } catch (err) {
    res.status(500).json({ message: "❌ Failed to get saved lists", error: err });
  }
});

// ✅ Get lists by user (add this back!)
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


// ✅ Single List View with CustomPoster lookup
// ✅ Get lists by user

router.get("/:id", async (req, res) => {
  try {
    const list = await List.findById(req.params.id)
      .populate("user", "username avatar");
    if (!list) return res.status(404).json({ message: "List not found" });

    const moviesWithOverride = await Promise.all(
      list.movies.map(async (movie) => {
        const custom = await CustomPoster.findOne({ movieId: parseInt(movie.id) });
        let posterUrl = null;

        if (custom) {
          posterUrl = custom.posterUrl;
        } else if (movie.poster) {
          posterUrl = movie.poster.startsWith("/")
            ? `${TMDB_IMG}${movie.poster}`
            : movie.poster;
        } else {
          // ⭐ New fallback: dynamically fetch from TMDB API
          try {
            const tmdbRes = await axios.get(`https://api.themoviedb.org/3/movie/${movie.id}?api_key=${TMDB_API_KEY}`);
            const posterPath = tmdbRes.data.poster_path;
            if (posterPath) {
              posterUrl = `${TMDB_IMG}${posterPath}`;
            }
          } catch (err) {
            console.warn(`⚠️ Failed to fetch TMDB poster for movie ${movie.id}:`, err.message);
          }
        }

        return {
          ...movie.toObject(),
          posterOverride: posterUrl
        };
      })
    );

    const result = {
      ...list.toObject(),
      movies: moviesWithOverride,
    };

    res.json(result);
  } catch (err) {
    console.error("❌ Failed to fetch list:", err);
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

// routes/listRoutes.js
router.post('/:id/share', protect, async (req, res) => {
  const { recipients } = req.body;
  const listId = req.params.id;
  const userId = req.user._id;

  try {
    const sender = await User.findById(userId);
    if (!sender) return res.status(404).json({ message: "Sender not found" });

    const list = await List.findById(listId);
    if (!list) return res.status(404).json({ message: "List not found" });

    const message = `@${sender.username} suggested you check out their list: "${list.title}"`;

    await Promise.all(
      recipients.map(async (rid) => {
        await User.findByIdAndUpdate(rid, {
          $push: {
            notifications: {
              type: "share-list",
              message,
              listId: list._id,
              fromUser: sender._id,
              createdAt: new Date(),
              read: false,
            },
          },
        });
      })
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Failed to share list", err);
    res.status(500).json({ message: "Internal server error" });
  }
});


module.exports = router;
