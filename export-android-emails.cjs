const fs = require("fs");
const path = require("path");
require("dotenv").config();

const { MongoClient } = require("mongodb");

const uri =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  process.env.MONGO_URL ||
  process.env.DB_URI;

if (!uri) {
  console.error("❌ MongoDB URI not found in environment variables.");
  process.exit(1);
}

const pipeline = [
  {
    $match: {
      createdAt: { $gte: new Date("2026-08-30T21:00:00Z") },
      email: { $type: "string" }
    }
  },
  {
    $lookup: {
      from: "logs",
      localField: "_id",
      foreignField: "user",
      pipeline: [{ $limit: 1 }],
      as: "movieLogs"
    }
  },
  {
    $lookup: {
      from: "tvlogs",
      localField: "_id",
      foreignField: "user",
      pipeline: [{ $limit: 1 }],
      as: "tvLogs"
    }
  },
  {
    $match: {
      "movieLogs.0": { $exists: false },
      "tvLogs.0": { $exists: false }
    }
  },
  {
    $project: {
      _id: 0,
      email: {
        $toLower: { $trim: { input: "$email" } }
      },
      language: 1,
      emailVerified: 1
    }
  },
  {
    $match: {
      email: { $regex: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" }
    }
  },
  {
    $group: {
      _id: "$email",
      language: { $first: "$language" },
      emailVerified: { $max: "$emailVerified" }
    }
  },
  {
    $project: {
      _id: 0,
      email: "$_id",
      language: 1,
      emailVerified: 1
    }
  },
  { $sort: { email: 1 } }
];

function csvCell(value) {
  return '"' + String(value ?? "").replace(/"/g, '""') + '"';
}

async function main() {
  const client = new MongoClient(uri);

  try {
    await client.connect();

    const users = await client
      .db("scene")
      .collection("users")
      .aggregate(pipeline)
      .toArray();

    const header = ["email", "language", "emailVerified"];

    const csv = [
      header.join(","),
      ...users.map(user => [
        csvCell(user.email),
        csvCell(user.language),
        csvCell(user.emailVerified === true)
      ].join(","))
    ].join("\n") + "\n";

    const output = path.resolve("scene-android-launch.csv");
    fs.writeFileSync(output, csv, { mode: 0o600 });
    fs.chmodSync(output, 0o600);

    console.log("✅ CSV exported successfully!");
    console.log("📧 Total candidate emails:", users.length);
    console.log("✅ Verified:", users.filter(u => u.emailVerified === true).length);
    console.log("⚠️ Unverified:", users.filter(u => u.emailVerified !== true).length);
    console.log("📁 Saved to:", output);
    console.log("🔒 File is private; no emails have been sent.");
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error("❌ Export failed:", err.message);
  process.exitCode = 1;
});
