// scripts/regenerateCurrentWeeklyShows.js

require("dotenv").config();

const mongoose = require("mongoose");

const WeeklyTVSelection = require(
  "../src/models/weeklyTVSelection"
);

const RIYADH_OFFSET_MS =
  3 * 60 * 60 * 1000;

function getCurrentWednesdayWeekKey(
  now = new Date()
) {
  const riyadhNow =
    new Date(
      now.getTime() +
        RIYADH_OFFSET_MS
    );

  const day =
    riyadhNow.getUTCDay();

  const daysSinceWednesday =
    (day - 3 + 7) % 7;

  const startRiyadh =
    new Date(
      Date.UTC(
        riyadhNow.getUTCFullYear(),
        riyadhNow.getUTCMonth(),
        riyadhNow.getUTCDate() -
          daysSinceWednesday,
        0,
        0,
        0,
        0
      )
    );

  const year =
    startRiyadh.getUTCFullYear();

  const month =
    String(
      startRiyadh.getUTCMonth() + 1
    ).padStart(2, "0");

  const date =
    String(
      startRiyadh.getUTCDate()
    ).padStart(2, "0");

  return `wednesday-${year}-${month}-${date}`;
}

async function main() {
  const mongoUri =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    process.env.DATABASE_URL ||
    process.env.DB_URI;

  if (!mongoUri) {
    throw new Error(
      "Missing MongoDB connection string. Expected MONGO_URI, MONGODB_URI, DATABASE_URL, or DB_URI."
    );
  }

  const weekKey =
    getCurrentWednesdayWeekKey();

  await mongoose.connect(
    mongoUri
  );

  const existing =
    await WeeklyTVSelection
      .findOne({
        weekKey,
      })
      .lean();

  if (!existing) {
    console.log(
      `No saved selection exists for ${weekKey}.`
    );

    console.log(
      "The next /api/tv-home request will generate it using the new rules."
    );

    return;
  }

  const result =
    await WeeklyTVSelection
      .deleteOne({
        weekKey,
      });

  console.log(
    `Deleted current Weekly Shows selection: ${weekKey}`
  );

  console.log(
    `Deleted documents: ${result.deletedCount || 0}`
  );

  console.log(
    "The next /api/tv-home request will generate new Trending, Airing, and Discovery picks."
  );
}

main()
  .catch(
    (error) => {
      console.error(
        "Failed to reset current Weekly Shows:",
        error?.message ||
        error
      );

      process.exitCode =
        1;
    }
  )
  .finally(
    async () => {
      await mongoose.disconnect();
    }
  );
