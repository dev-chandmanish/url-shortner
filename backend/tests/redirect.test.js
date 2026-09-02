const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

require("dotenv").config();

const app = require("../src/app");
const pool = require("../src/db/postgres");
const redisClient = require("../src/db/redis");
const { urlCacheKey } = require("../src/db/urlCache");
const { clickKey, getClickCount } = require("../src/db/clickCounters");

let server;
let baseUrl;

function getSessionId(setCookies) {
  const cookie = setCookies.find((value) => value.startsWith("sessionId="));
  assert.ok(cookie, "sessionId cookie was not set");
  return cookie.split(";")[0].slice("sessionId=".length);
}

async function jsonRequest(path, { method = "GET", body, sessionId } = {}) {
  const headers = {};

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (sessionId) {
    headers.Cookie = `sessionId=${sessionId}`;
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [];

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  return {
    status: res.status,
    body: json,
    cookies: setCookies,
  };
}

async function signupAndCreateUrl(originalUrl) {
  const email = `redirect-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const signupRes = await jsonRequest("/api/auth/signup", {
    method: "POST",
    body: { email, password: "password123" },
  });

  assert.equal(signupRes.status, 201);
  const sessionId = getSessionId(signupRes.cookies);

  const created = await jsonRequest("/api/urls", {
    method: "POST",
    sessionId,
    body: { originalUrl },
  });

  assert.equal(created.status, 201);
  return created.body;
}

describe("GET /:shortCode", () => {
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

  it("existing short code redirects with 302 to the original URL", async () => {
    const originalUrl = "https://example.com/redirect-target";
    const created = await signupAndCreateUrl(originalUrl);

    const res = await fetch(`${baseUrl}/${created.shortCode}`, {
      redirect: "manual",
    });

    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), originalUrl);
  });

  it("nonexistent short code returns 404", async () => {
    const res = await fetch(`${baseUrl}/noCode`, { redirect: "manual" });
    const body = await res.json();

    assert.equal(res.status, 404);
    assert.equal(body.error, "Not found");
  });

  it("cache miss queries PostgreSQL, populates Redis, and redirects", async () => {
    const originalUrl = "https://example.com/cache-miss";
    const created = await signupAndCreateUrl(originalUrl);
    const cacheKey = urlCacheKey(created.shortCode);

    await redisClient.del(cacheKey);
    assert.equal(await redisClient.get(cacheKey), null);

    const res = await fetch(`${baseUrl}/${created.shortCode}`, {
      redirect: "manual",
    });

    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), originalUrl);
    assert.equal(await redisClient.get(cacheKey), originalUrl);
  });

  it("endpoint is accessible without authentication", async () => {
    const originalUrl = "https://example.com/public-redirect";
    const created = await signupAndCreateUrl(originalUrl);

    const res = await fetch(`${baseUrl}/${created.shortCode}`, {
      redirect: "manual",
    });

    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), originalUrl);
  });

  it("successful redirect increments the Redis click counter", async () => {
    const originalUrl = "https://example.com/click-count";
    const created = await signupAndCreateUrl(originalUrl);
    await redisClient.del(clickKey(created.shortCode));

    const res = await fetch(`${baseUrl}/${created.shortCode}`, {
      redirect: "manual",
    });

    assert.equal(res.status, 302);
    assert.equal(await getClickCount(created.shortCode), 1);
  });

  it("nonexistent short code does not increment clicks", async () => {
    const missingCode = "zzZZ99";
    await redisClient.del(clickKey(missingCode));

    const res = await fetch(`${baseUrl}/${missingCode}`, { redirect: "manual" });
    assert.equal(res.status, 404);
    assert.equal(await getClickCount(missingCode), 0);
  });

  it("click counting is independent of Redis URL cache hits and misses", async () => {
    const originalUrl = "https://example.com/cache-independent-clicks";
    const created = await signupAndCreateUrl(originalUrl);
    const cacheKey = urlCacheKey(created.shortCode);
    const counterKey = clickKey(created.shortCode);

    await redisClient.del(cacheKey);
    await redisClient.del(counterKey);

    const miss = await fetch(`${baseUrl}/${created.shortCode}`, {
      redirect: "manual",
    });
    assert.equal(miss.status, 302);
    assert.equal(await redisClient.get(cacheKey), originalUrl);
    assert.equal(await getClickCount(created.shortCode), 1);

    const hit = await fetch(`${baseUrl}/${created.shortCode}`, {
      redirect: "manual",
    });
    assert.equal(hit.status, 302);
    assert.equal(await getClickCount(created.shortCode), 2);
  });
});
