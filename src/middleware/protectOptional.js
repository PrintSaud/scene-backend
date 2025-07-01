const jwt = require("jsonwebtoken");
const User = require("../models/user");

const protectOptional = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return next();

  try {
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select("_id");
  } catch {
    req.user = null;
  }

  next();
};

module.exports = protectOptional;
