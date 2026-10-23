const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../model/user");
const Init = require("../models/init");
const Params = require("../models/params");
const Bets = require("../models/bets");
const Report = require("../model/report");

const router = express.Router();

function normalizeContext(value) {
  const raw = String(value || '').toLowerCase();
  if (!raw) return null;
  if (raw.includes('gambit')) return 'gambit';
  if (raw.includes('cumbre') || raw.includes('cumber')) return 'cumbre';
  return null;
}

function contextFromUrl(urlLike) {
  if (!urlLike) return null;
  const text = String(urlLike).toLowerCase();
  if (text.includes('gambit')) return 'gambit';
  if (text.includes('cumbre') || text.includes('cumber')) return 'cumbre';
  return null;
}

function detectRequestContext(req) {
  return (
    normalizeContext(req.headers['x-app-context']) ||
    normalizeContext(req.body?.appContext) ||
    contextFromUrl(req.headers.origin) ||
    contextFromUrl(req.headers.referer) ||
    contextFromUrl(req.headers.host) ||
    'default'
  );
}

async function purgeExpiredMeetings() {
  try {
    const cutoff = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);

    // Find the earliest createdAt per meetingName
    const meetings = await Init.aggregate([
      {
        $group: {
          _id: "$meetingName",
          firstCreated: { $min: "$createdAt" }
        }
      },
      {
        $match: { firstCreated: { $lt: cutoff } }
      }
    ]);

    if (meetings.length === 0) return;

    const expiredNames = meetings.map(m => m._id);
    console.log(`Purging expired meetings (>6 days old): ${expiredNames.join(", ")}`);

    await Promise.all([
      Init.deleteMany({ meetingName: { $in: expiredNames } }),
      Params.deleteMany({ meetingName: { $in: expiredNames } }),
      Bets.deleteMany({ meetingName: { $in: expiredNames } }),
      Report.deleteMany({ meetingName: { $in: expiredNames } })
    ]);

    console.log(`Purged data for ${expiredNames.length} meeting(s).`);
  } catch (err) {
    console.error("Error purging expired meetings:", err);
  }
}

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret";

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const requestContext = detectRequestContext(req);

    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "Username and password are required" });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const appScope = (user.appScope && user.appScope !== 'default')
      ? user.appScope
      : (requestContext || 'default');

    const token = jwt.sign(
      { userId: user._id, username: user.username, appScope },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        username: user.username,
        appScope,
      },
    });

    // Purge meetings older than 6 days (fire-and-forget)
    purgeExpiredMeetings();
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Access token required" });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: "Invalid token" });
    }

    const requestContext = detectRequestContext(req);
    const tokenScope = user.appScope || 'default';
    if (requestContext && tokenScope && requestContext !== tokenScope) {
      return res.status(403).json({ message: 'Token scope mismatch. Please login for this app context.' });
    }

    req.user = user;
    next();
  });
};

router.post("/change-password", authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ message: "Current password and new password are required" });
    }

    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({ message: "New password must be at least 6 characters long" });
    }

    const user = await User.findById(req.user.userId);
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const isValidCurrentPassword = await user.comparePassword(currentPassword);
    
    if (!isValidCurrentPassword) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    user.password = newPassword;
    await user.save();

    res.json({
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

module.exports = { router, authenticateToken };
