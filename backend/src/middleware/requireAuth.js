const sessionService = require("../services/sessionService");

async function requireAuth(req, res, next) {
  try {
    const sessionId = req.cookies?.[sessionService.SESSION_COOKIE_NAME];
    const userId = await sessionService.getUserId(sessionId);

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    req.user = { id: userId };
    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = requireAuth;
