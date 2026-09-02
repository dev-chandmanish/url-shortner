const authService = require("../services/authService");
const sessionService = require("../services/sessionService");

function setSessionCookie(res, sessionId) {
  res.cookie(
    sessionService.SESSION_COOKIE_NAME,
    sessionId,
    sessionService.getCookieOptions()
  );
}

function clearSessionCookie(res) {
  res.clearCookie(
    sessionService.SESSION_COOKIE_NAME,
    sessionService.getClearCookieOptions()
  );
}

async function signup(req, res) {
  try {
    const { email, password } = req.body ?? {};
    const user = await authService.signup({ email, password });

    setSessionCookie(res, user.sessionId);

    res.status(201).json({
      id: user.id,
      email: user.email,
    });
  } catch (error) {
    if (error.statusCode === 400 || error.statusCode === 409) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body ?? {};
    const user = await authService.login({ email, password });

    setSessionCookie(res, user.sessionId);

    res.status(200).json({
      id: user.id,
      email: user.email,
    });
  } catch (error) {
    if (error.statusCode === 400 || error.statusCode === 401) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
}

async function logout(req, res) {
  try {
    const sessionId = req.cookies?.[sessionService.SESSION_COOKIE_NAME];
    await sessionService.destroySession(sessionId);
    clearSessionCookie(res);
    res.status(200).json({ message: "Logged out" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
}

async function me(req, res) {
  try {
    const user = await authService.getCurrentUser(req.user.id);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    res.status(200).json({
      id: user.id,
      email: user.email,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = {
  signup,
  login,
  logout,
  me,
};
