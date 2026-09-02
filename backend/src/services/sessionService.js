const { randomBytes } = require("crypto");
const sessionsDb = require("../db/sessions");

const SESSION_COOKIE_NAME = "sessionId";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function isCookieSecure() {
  if (process.env.COOKIE_SECURE === "true") {
    return true;
  }

  if (process.env.COOKIE_SECURE === "false") {
    return false;
  }

  return process.env.NODE_ENV === "production";
}

function getCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS * 1000,
    secure: isCookieSecure(),
    path: "/",
  };
}

function getClearCookieOptions() {
  const { maxAge, ...options } = getCookieOptions();
  return options;
}

async function createSession(userId) {
  const sessionId = randomBytes(32).toString("hex");
  await sessionsDb.saveSession(sessionId, userId, SESSION_TTL_SECONDS);
  return sessionId;
}

async function getUserId(sessionId) {
  if (!sessionId) {
    return null;
  }

  return sessionsDb.getSession(sessionId);
}

async function destroySession(sessionId) {
  if (!sessionId) {
    return;
  }

  await sessionsDb.deleteSession(sessionId);
}

module.exports = {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  createSession,
  getUserId,
  destroySession,
  getCookieOptions,
  getClearCookieOptions,
};
