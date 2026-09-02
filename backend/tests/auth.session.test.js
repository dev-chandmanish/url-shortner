const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

require("dotenv").config();

const app = require("../src/app");
const pool = require("../src/db/postgres");
const redisClient = require("../src/db/redis");
const { sessionKey } = require("../src/db/sessions");

let server;
let baseUrl;

function findSessionCookie(setCookies) {
  return setCookies.find((cookie) => cookie.startsWith("sessionId="));
}

function getSessionId(setCookies) {
  const cookie = findSessionCookie(setCookies);
  assert.ok(cookie, "sessionId cookie was not set");
  return cookie.split(";")[0].slice("sessionId=".length);
}

function cookieHeader(sessionId) {
  return `sessionId=${sessionId}`;
}

async function request(path, { method = "GET", body, sessionId } = {}) {
  const headers = {};

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (sessionId) {
    headers.Cookie = cookieHeader(sessionId);
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const setCookies = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : [];

  let json = null;
  const text = await res.text();
  if (text) {
    json = JSON.parse(text);
  }

  return {
    status: res.status,
    body: json,
    cookies: setCookies,
  };
}

describe("auth sessions", () => {
  before(async () => {
    await pool.query("SELECT 1");
    await redisClient.ping();

    server = app.listen(0);
    await once(server, "listening");
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) {
      server.close();
      await once(server, "close");
    }

    await pool.end();

    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  });

  it("signup creates a Redis session and sets an HTTP-only session cookie", async () => {
    const email = `session-${Date.now()}@example.com`;
    const res = await request("/api/auth/signup", {
      method: "POST",
      body: { email, password: "password123" },
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.email, email);
    assert.ok(res.body.id);
    assert.equal(res.body.sessionId, undefined);

    const cookie = findSessionCookie(res.cookies);
    assert.ok(cookie);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);

    const sessionId = getSessionId(res.cookies);
    const storedUserId = await redisClient.get(sessionKey(sessionId));
    assert.equal(storedUserId, res.body.id);
  });

  it("GET /me returns the authenticated user", async () => {
    const email = `me-${Date.now()}@example.com`;
    const signupRes = await request("/api/auth/signup", {
      method: "POST",
      body: { email, password: "password123" },
    });

    assert.equal(signupRes.status, 201);
    const sessionId = getSessionId(signupRes.cookies);

    const meRes = await request("/api/auth/me", { sessionId });

    assert.equal(meRes.status, 200);
    assert.deepEqual(meRes.body, {
      id: signupRes.body.id,
      email,
    });
  });

  it("GET /me returns 401 without a session", async () => {
    const res = await request("/api/auth/me");
    assert.equal(res.status, 401);
    assert.equal(res.body.error, "Unauthorized");
  });

  it("logout deletes the session and clears the cookie", async () => {
    const email = `logout-${Date.now()}@example.com`;
    const signupRes = await request("/api/auth/signup", {
      method: "POST",
      body: { email, password: "password123" },
    });

    assert.equal(signupRes.status, 201);
    const sessionId = getSessionId(signupRes.cookies);
    assert.equal(await redisClient.get(sessionKey(sessionId)), signupRes.body.id);

    const logoutRes = await request("/api/auth/logout", {
      method: "POST",
      sessionId,
    });

    assert.equal(logoutRes.status, 200);
    assert.equal(logoutRes.body.message, "Logged out");

    const logoutCookie = findSessionCookie(logoutRes.cookies);
    assert.ok(logoutCookie);
    assert.match(logoutCookie, /sessionId=;/);

    assert.equal(await redisClient.get(sessionKey(sessionId)), null);

    const meRes = await request("/api/auth/me", { sessionId });
    assert.equal(meRes.status, 401);
  });
});
