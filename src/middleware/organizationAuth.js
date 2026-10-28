
const crypto = require("crypto");

const OrganizationApplication = require(
  "../models/OrganizationApplication"
);

const OrganizationSession = require(
  "../models/OrganizationSession"
);

function hashToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

async function organizationAuth(req, res, next) {
  try {
    const header = req.get("Authorization") || "";

    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Organization authentication required.",
      });
    }

    const token = header.slice(7).trim();

    if (!/^[a-f0-9]{64}$/.test(token)) {
      return res.status(401).json({
        error: "Invalid organization session.",
      });
    }

    const session = await OrganizationSession.findOne({
      tokenHash: hashToken(token),
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });

    if (!session) {
      return res.status(401).json({
        error: "Organization session expired or revoked.",
      });
    }

    const organization =
      await OrganizationApplication.findOne({
        _id: session.organization,
        status: "approved",
      });

    if (!organization) {
      return res.status(403).json({
        error: "Organization access is not approved.",
      });
    }

    req.organization = organization;
    req.organizationSession = session;

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = organizationAuth;
