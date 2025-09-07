// src/routes/watchlist.js
const express = require("express");
const router = express.Router();
const User = require("../models/user");
const protect = require("../middleware/authMiddleware");
const { getMovieDetails } = require("../services/tmdbService");
const CustomPoster = require("../models/customPoster");

// ✅ Check watchlist status (auth only)
router.get("/status/:movieId", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const movieId = Number(req.params.movieId);
    const inWatchlist = user.watchlist?.some((w) => w.tmdbId === movieId);
    res.json({ inWatchlist });
  } catch (err) {
    console.error("Watchlist check error:", err);
    res.status(500).json({ error: "Failed to check watchlist" });
  }
});

// ✅ Toggle watchlist (auth only) — now auto-cleaning malformed entries
router.post("/toggle", protect, async (req, res) => {
  const { movieId } = req.body;
  const userId = req.user._id;

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    // 🧹 Clean malformed entries
    user.watchlist = user.watchlist.filter(
      (w) => typeof w === "object" && w.tmdbId
    );
    await user.save();

    const alreadyIn = user.watchlist?.some((w) => w.tmdbId === movieId);

    if (alreadyIn) {
      await User.findByIdAndUpdate(
        userId,
        { $pull: { watchlist: { tmdbId: movieId } } },
        { new: true }
      );
      return res.json({ message: "Removed from watchlist", inWatchlist: false });
    } else {
      const details = await getMovieDetails(movieId);
      await User.findByIdAndUpdate(
        userId,
        {
          $push: {
            watchlist: {
              tmdbId: movieId,
              poster_path: details?.poster_path || null,
              title: details?.title || null,
              release_date: details?.release_date || null,
              runtime: details?.runtime || null,
              vote_average: details?.vote_average || null,
              genres: details?.genres || [],
              addedAt: new Date(),
            },
          },
        },
        { new: true }
      );

      return res.json({ message: "Added to watchlist", inWatchlist: true });
    }
  } catch (err) {
    console.error("Toggle watchlist error:", err);
    res.status(500).json({ error: "Failed to toggle watchlist" });
  }
});

// ✅ Add to watchlist manually (non-auth fallback)
router.post("/:userId/watchlist", async (req, res) => {
  const { userId } = req.params;
  const { tmdbId } = req.body;
  if (!tmdbId) return res.status(400).json({ error: "tmdbId is required" });

  try {
    await User.findByIdAndUpdate(
      userId,
      { $push: { watchlist: { tmdbId, addedAt: new Date() } } },
      { new: true }
    );

    const user = await User.findById(userId);
    let cleanedWatchlist = user.watchlist.filter(
      (item) => typeof item === "object" && item.tmdbId
    );

    let movieDetails = await Promise.all(
      cleanedWatchlist.map((w) => getMovieDetails(w.tmdbId))
    );

    movieDetails = movieDetails.filter(
      (movie) => movie && movie.id && movie.poster_path
    );

    res.json(movieDetails);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not add to watchlist" });
  }
});

// ✅ Remove from watchlist manually
router.delete("/:userId/watchlist/:tmdbId", async (req, res) => {
  const { userId, tmdbId } = req.params;

  try {
    const user = await User.findByIdAndUpdate(
      userId,
      { $pull: { watchlist: { tmdbId: Number(tmdbId) } } },
      { new: true }
    );

    res.json(user.watchlist);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not remove from watchlist" });
  }
});

// ✅ Fast Watchlist (resilient: hydrates when needed, safe sorting)
router.get("/:userId/watchlist", async (req, res) => {
  const { userId } = req.params;
  const rawSort = req.query.sort || "added";
  const rawOrder = req.query.order === "asc" ? "asc" : "desc";
  const genre = req.query.genre ? Number(req.query.genre) : null;

  const ALLOWED_SORTS = new Set(["added", "release", "rating", "runtime"]);
  const sort = ALLOWED_SORTS.has(rawSort) ? rawSort : "added";
  const dir = rawOrder === "asc" ? 1 : -1;

  const toTs = (d) => (d ? new Date(d).getTime() || 0 : 0);

  try {
    const user = await User.findById(userId).lean();
    if (!user || !user.watchlist) {
      return res.status(404).json({ error: "User or watchlist not found" });
    }

    let movies = user.watchlist.filter(
      (w) => typeof w === "object" && w.tmdbId
    );

    // Hydrate any entries missing runtime, rating, release_date, or genres
    const needHydrate = movies.filter(
      (m) =>
        !Array.isArray(m.genres) ||
        m.genres.length === 0 ||
        m.runtime == null ||
        m.vote_average == null ||
        !m.release_date
    );

    if (needHydrate.length) {
      await Promise.all(
        needHydrate.map(async (m) => {
          try {
            const d = await getMovieDetails(m.tmdbId);
            m.genres = d?.genres || [];
            m.runtime = d?.runtime ?? null;
            m.vote_average = d?.vote_average ?? null;
            m.release_date = d?.release_date ?? null;

            await User.updateOne(
              { _id: userId, "watchlist.tmdbId": m.tmdbId },
              {
                $set: {
                  "watchlist.$.genres": m.genres,
                  "watchlist.$.runtime": m.runtime,
                  "watchlist.$.vote_average": m.vote_average,
                  "watchlist.$.release_date": m.release_date,
                },
              }
            );
          } catch (e) {
            // ignore per-item errors
          }
        })
      );
    }

    // Apply genre filter if requested
    if (Number.isFinite(genre) && genre > 0) {
      movies = movies.filter(
        (m) =>
          Array.isArray(m.genres) && m.genres.some((g) => g.id === genre)
      );
    }

    // Safe sort
    movies.sort((a, b) => {
      if (sort === "added") {
        return (toTs(a.addedAt) - toTs(b.addedAt)) * dir;
      }
      if (sort === "release") {
        return (toTs(a.release_date) - toTs(b.release_date)) * dir;
      }
      if (sort === "rating") {
        const av = Number.isFinite(a?.vote_average) ? a.vote_average : 0;
        const bv = Number.isFinite(b?.vote_average) ? b.vote_average : 0;
        return (av - bv) * dir;
      }
      if (sort === "runtime") {
        const ar = Number.isFinite(a?.runtime) ? a.runtime : 0;
        const br = Number.isFinite(b?.runtime) ? b.runtime : 0;
        return (ar - br) * dir;
      }
      return ((a.title || "").localeCompare(b.title || "")) * dir;
    });

    // Custom posters
    const customPosters = await CustomPoster.find({
      userId,
      movieId: { $in: movies.map((m) => String(m.tmdbId)) },
    }).lean();

    const postersMap = {};
    for (const cp of customPosters) {
      postersMap[String(cp.movieId)] = cp.posterUrl;
    }

    // Enrich missing poster_path if needed
    const enriched = await Promise.all(
      movies.map(async (m) => {
        let poster_path = m.poster_path || null;
        let title = m.title || null;
        let release_date = m.release_date || null;

        if (!poster_path) {
          try {
            const d = await getMovieDetails(m.tmdbId);
            poster_path = d?.poster_path || null;
            title = title || d?.title || null;
            release_date = release_date || d?.release_date || null;
          } catch {
            // ignore per-item fetch errors
          }
        }

        return {
          ...m,
          posterOverride: postersMap[String(m.tmdbId)] || null,
          poster_path,
          title,
          release_date,
        };
      })
    );

    res.json(enriched);
  } catch (err) {
    console.error("❌ Failed to fetch watchlist", err);
    res.status(500).json({ error: "Could not fetch watchlist" });
  }
});

module.exports = router;
