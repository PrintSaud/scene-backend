const jwt = require("jsonwebtoken");
const User = require("../models/user");

const protect = async (req, res, next) => {
  let token;
  console.log("👉 Token received:", token);
  console.log("👉 Decoded payload:", decoded);
  console.log("👉 User fetched:", req.user);
  
  // DEBUG: Log what JWT_SECRET we are using
  console.log("🔒 protect middleware running — JWT_SECRET:", process.env.JWT_SECRET);

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];

      // Verify the token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Fetch user from DB (exclude password)
      req.user = await User.findById(decoded.id).select("-password");

      // If user doesn't exist
      if (!req.user) {
        console.log("❌ User not found for decoded.id:", decoded.id);
        return res.status(401).json({ error: "User not found" });
      }

      return next();
    } catch (error) {
      console.error("❌ JWT Error:", error.message);
      return res.status(401).json({ error: "Token is invalid or expired" });
    }
  }

  console.warn("⚠️ No token provided in Authorization header");
  return res.status(401).json({ error: "Not authorized, no token" });
};

module.exports = protect;
