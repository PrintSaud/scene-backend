const axios = require("axios");
const fs = require("fs");
const path = require("path");

module.exports = async function saveImageFromUrl(url, filename) {
  const uploadsDir = path.join(__dirname, "..", "uploads");

  // Create the directory if it doesn't exist
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
  }

  const filepath = path.join(uploadsDir, filename);
  const writer = fs.createWriteStream(filepath);

  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", () => resolve(`/uploads/${filename}`));
    writer.on("error", reject);
  });
};
