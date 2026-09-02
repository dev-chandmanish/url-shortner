const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

require("dotenv").config();

const app = require("../src/app");
const pool = require("../src/db/postgres");
const redisClient = require("../src/db/redis");
const { SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH } = require("../src/services/urlService");
const { urlCacheKey } = require("../src/db/urlCache");

let server;
let baseUrl;

function getSessionId(setCookies) {
  const cookie = setCookies.find((value) => value.startsWith("sessionId="));
  assert.ok(cookie, "sessionId cookie was not set");
  return cookie.split(";")[0].slice("sessionId=".length);
}

async function request(path, { method = "GET", body, sessionId } = {}) {
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

async function signup() {
  const email = `urls-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const res = await request("/api/auth/signup", {
    method: "POST",
    body: { email, password: "password123" },
  });

  assert.equal(res.status, 201);
  return {
    user: res.body,
    sessionId: getSessionId(res.cookies),
  };
}

describe("urls api", () => {
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

  describe("POST /api/urls", () => {

  it("authenticated user can create a URL and receives 201", async () => {
    const { sessionId } = await signup();
    const originalUrl = "https://example.com/a/very/long/url";

    const res = await request("/api/urls", {
      method: "POST",
      sessionId,
      body: { originalUrl },
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.originalUrl, originalUrl);
    assert.equal(typeof res.body.id, "string");
    assert.equal(res.body.shortCode.length, SHORT_CODE_LENGTH);
    assert.match(
      res.body.shortCode,
      new RegExp(`^[${SHORT_CODE_ALPHABET}]+$`)
    );
    assert.equal(
      res.body.shortUrl,
      `${(process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "")}/${res.body.shortCode}`
    );
    assert.equal(res.body.sessionId, undefined);
    assert.equal(res.body.password, undefined);
    assert.equal(res.body.password_hash, undefined);
  });

  it("unauthenticated user receives 401", async () => {
    const res = await request("/api/urls", {
      method: "POST",
      body: { originalUrl: "https://example.com" },
    });

    assert.equal(res.status, 401);
    assert.equal(res.body.error, "Unauthorized");
  });

  it("missing URL receives a 4xx response", async () => {
    const { sessionId } = await signup();
    const res = await request("/api/urls", {
      method: "POST",
      sessionId,
      body: {},
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, "Original URL is required");
  });

  it("invalid URL receives a 4xx response", async () => {
    const { sessionId } = await signup();
    const res = await request("/api/urls", {
      method: "POST",
      sessionId,
      body: { originalUrl: "not-a-url" },
    });

    assert.equal(res.status, 400);
  });

  it("non-HTTP URL receives a 4xx response", async () => {
    const { sessionId } = await signup();
    const res = await request("/api/urls", {
      method: "POST",
      sessionId,
      body: { originalUrl: "ftp://example.com/file" },
    });

    assert.equal(res.status, 400);
  });
});

describe("GET /api/urls", () => {
  it("authenticated user can retrieve their URLs", async () => {
    const { sessionId } = await signup();
    const originalUrl = "https://example.com/mine";

    const created = await request("/api/urls", {
      method: "POST",
      sessionId,
      body: { originalUrl },
    });

    assert.equal(created.status, 201);

    const res = await request("/api/urls", { sessionId });

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].id, created.body.id);
    assert.equal(res.body[0].shortCode, created.body.shortCode);
    assert.equal(res.body[0].originalUrl, originalUrl);
    assert.equal(res.body[0].clickCount, 0);
    assert.equal(typeof res.body[0].createdAt, "string");
    assert.equal(res.body[0].shortUrl, created.body.shortUrl);
  });

  it("unauthenticated user receives 401", async () => {
    const res = await request("/api/urls");
    assert.equal(res.status, 401);
    assert.equal(res.body.error, "Unauthorized");
  });

  it("only the authenticated user's URLs are returned", async () => {
    const userA = await signup();
    const userB = await signup();

    const createdA = await request("/api/urls", {
      method: "POST",
      sessionId: userA.sessionId,
      body: { originalUrl: "https://example.com/a" },
    });
    const createdB = await request("/api/urls", {
      method: "POST",
      sessionId: userB.sessionId,
      body: { originalUrl: "https://example.com/b" },
    });

    assert.equal(createdA.status, 201);
    assert.equal(createdB.status, 201);

    const listA = await request("/api/urls", { sessionId: userA.sessionId });
    const listB = await request("/api/urls", { sessionId: userB.sessionId });

    assert.equal(listA.status, 200);
    assert.equal(listB.status, 200);
    assert.deepEqual(
      listA.body.map((url) => url.id),
      [createdA.body.id]
    );
    assert.deepEqual(
      listB.body.map((url) => url.id),
      [createdB.body.id]
    );
  });

  it("URLs are ordered by newest created_at first", async () => {
    const { sessionId } = await signup();

    const older = await request("/api/urls", {
      method: "POST",
      sessionId,
      body: { originalUrl: "https://example.com/older" },
    });
    const newer = await request("/api/urls", {
      method: "POST",
      sessionId,
      body: { originalUrl: "https://example.com/newer" },
    });

    assert.equal(older.status, 201);
    assert.equal(newer.status, 201);

    await pool.query(
      `UPDATE urls SET created_at = $1 WHERE id = $2`,
      [new Date("2024-01-01T00:00:00.000Z"), older.body.id]
    );
    await pool.query(
      `UPDATE urls SET created_at = $1 WHERE id = $2`,
      [new Date("2026-01-01T00:00:00.000Z"), newer.body.id]
    );

    const res = await request("/api/urls", { sessionId });

    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.map((url) => url.id),
      [newer.body.id, older.body.id]
    );
  });

  it("user with no URLs receives an empty array", async () => {
    const { sessionId } = await signup();
    const res = await request("/api/urls", { sessionId });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });

  it("response does not expose sensitive information", async () => {
    const { sessionId } = await signup();

    await request("/api/urls", {
      method: "POST",
      sessionId,
      body: { originalUrl: "https://example.com/private" },
    });

    const res = await request("/api/urls", { sessionId });

    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);

    const url = res.body[0];
    assert.deepEqual(Object.keys(url).sort(), [
      "clickCount",
      "createdAt",
      "id",
      "originalUrl",
      "shortCode",
      "shortUrl",
    ]);
    assert.equal(url.password, undefined);
    assert.equal(url.password_hash, undefined);
    assert.equal(url.sessionId, undefined);
    assert.equal(url.user_id, undefined);
    assert.equal(url.userId, undefined);
  });
});

  describe("GET /api/urls/:id/stats", () => {
    it("authenticated owner can retrieve URL stats", async () => {
      const { sessionId } = await signup();
      const originalUrl = "https://example.com/stats-owner";

      const created = await request("/api/urls", {
        method: "POST",
        sessionId,
        body: { originalUrl },
      });

      assert.equal(created.status, 201);

      const res = await request(`/api/urls/${created.body.id}/stats`, {
        sessionId,
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.id, created.body.id);
      assert.equal(res.body.shortCode, created.body.shortCode);
      assert.equal(res.body.originalUrl, originalUrl);
      assert.equal(res.body.shortUrl, created.body.shortUrl);
      assert.equal(typeof res.body.createdAt, "string");
      assert.equal(res.body.clickCount, 0);
    });

    it("unauthenticated request returns 401", async () => {
      const res = await request(
        "/api/urls/11111111-1111-1111-1111-111111111111/stats"
      );

      assert.equal(res.status, 401);
      assert.equal(res.body.error, "Unauthorized");
    });

    it("URL belonging to another user is not accessible", async () => {
      const owner = await signup();
      const other = await signup();

      const created = await request("/api/urls", {
        method: "POST",
        sessionId: owner.sessionId,
        body: { originalUrl: "https://example.com/private-stats" },
      });

      assert.equal(created.status, 201);

      const res = await request(`/api/urls/${created.body.id}/stats`, {
        sessionId: other.sessionId,
      });

      assert.equal(res.status, 404);
      assert.equal(res.body.error, "Not found");
    });

    it("nonexistent URL returns 404", async () => {
      const { sessionId } = await signup();
      const res = await request(
        "/api/urls/11111111-1111-1111-1111-111111111111/stats",
        { sessionId }
      );

      assert.equal(res.status, 404);
      assert.equal(res.body.error, "Not found");
    });

    it("response returns persisted clickCount", async () => {
      const { sessionId } = await signup();
      const created = await request("/api/urls", {
        method: "POST",
        sessionId,
        body: { originalUrl: "https://example.com/persisted-clicks" },
      });

      assert.equal(created.status, 201);

      await pool.query(`UPDATE urls SET click_count = $1 WHERE id = $2`, [
        7,
        created.body.id,
      ]);

      const res = await request(`/api/urls/${created.body.id}/stats`, {
        sessionId,
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.clickCount, 7);
    });

    it("response contains shortCode, originalUrl, shortUrl and createdAt", async () => {
      const { sessionId } = await signup();
      const originalUrl = "https://example.com/stats-fields";
      const created = await request("/api/urls", {
        method: "POST",
        sessionId,
        body: { originalUrl },
      });

      const res = await request(`/api/urls/${created.body.id}/stats`, {
        sessionId,
      });

      assert.equal(res.status, 200);
      assert.equal(typeof res.body.shortCode, "string");
      assert.equal(res.body.originalUrl, originalUrl);
      assert.equal(typeof res.body.shortUrl, "string");
      assert.ok(res.body.shortUrl.includes(res.body.shortCode));
      assert.equal(typeof res.body.createdAt, "string");
    });

    it("response does not expose user_id or internal fields", async () => {
      const { sessionId } = await signup();
      const created = await request("/api/urls", {
        method: "POST",
        sessionId,
        body: { originalUrl: "https://example.com/stats-private-fields" },
      });

      const res = await request(`/api/urls/${created.body.id}/stats`, {
        sessionId,
      });

      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys(res.body).sort(), [
        "clickCount",
        "createdAt",
        "id",
        "originalUrl",
        "shortCode",
        "shortUrl",
      ]);
      assert.equal(res.body.user_id, undefined);
      assert.equal(res.body.userId, undefined);
      assert.equal(res.body.sessionId, undefined);
      assert.equal(res.body.batch_id, undefined);
      assert.equal(res.body.batchId, undefined);
    });
  });

  describe("DELETE /api/urls/:id", () => {
    it("authenticated owner can delete their URL", async () => {
      const { sessionId } = await signup();
      const created = await request("/api/urls", {
        method: "POST",
        sessionId,
        body: { originalUrl: "https://example.com/delete-me" },
      });

      assert.equal(created.status, 201);

      const res = await request(`/api/urls/${created.body.id}`, {
        method: "DELETE",
        sessionId,
      });

      assert.equal(res.status, 204);
      assert.equal(res.body, null);

      const remaining = await pool.query(`SELECT id FROM urls WHERE id = $1`, [
        created.body.id,
      ]);
      assert.equal(remaining.rowCount, 0);
    });

    it("unauthenticated request returns 401", async () => {
      const res = await request(
        "/api/urls/11111111-1111-1111-1111-111111111111",
        { method: "DELETE" }
      );

      assert.equal(res.status, 401);
      assert.equal(res.body.error, "Unauthorized");
    });

    it("nonexistent URL returns 404", async () => {
      const { sessionId } = await signup();
      const res = await request(
        "/api/urls/11111111-1111-1111-1111-111111111111",
        { method: "DELETE", sessionId }
      );

      assert.equal(res.status, 404);
      assert.equal(res.body.error, "Not found");
    });

    it("user cannot delete another user's URL and receives 404", async () => {
      const owner = await signup();
      const other = await signup();
      const created = await request("/api/urls", {
        method: "POST",
        sessionId: owner.sessionId,
        body: { originalUrl: "https://example.com/not-yours" },
      });

      const res = await request(`/api/urls/${created.body.id}`, {
        method: "DELETE",
        sessionId: other.sessionId,
      });

      assert.equal(res.status, 404);
      assert.equal(res.body.error, "Not found");

      const remaining = await pool.query(`SELECT id FROM urls WHERE id = $1`, [
        created.body.id,
      ]);
      assert.equal(remaining.rowCount, 1);
    });

    it("successful deletion returns 204 with an empty response body", async () => {
      const { sessionId } = await signup();
      const created = await request("/api/urls", {
        method: "POST",
        sessionId,
        body: { originalUrl: "https://example.com/empty-body" },
      });

      const res = await fetch(`${baseUrl}/api/urls/${created.body.id}`, {
        method: "DELETE",
        headers: { Cookie: `sessionId=${sessionId}` },
      });

      assert.equal(res.status, 204);
      assert.equal(await res.text(), "");
    });

    it("Redis url:<shortCode> cache is invalidated after successful deletion", async () => {
      const { sessionId } = await signup();
      const created = await request("/api/urls", {
        method: "POST",
        sessionId,
        body: { originalUrl: "https://example.com/cached-delete" },
      });

      const redirect = await fetch(`${baseUrl}/${created.body.shortCode}`, {
        redirect: "manual",
      });
      assert.equal(redirect.status, 302);
      assert.equal(
        await redisClient.get(urlCacheKey(created.body.shortCode)),
        "https://example.com/cached-delete"
      );

      const res = await request(`/api/urls/${created.body.id}`, {
        method: "DELETE",
        sessionId,
      });

      assert.equal(res.status, 204);
      assert.equal(
        await redisClient.get(urlCacheKey(created.body.shortCode)),
        null
      );
    });

    it("Redis is NOT invalidated when PostgreSQL deletion fails", async () => {
      const owner = await signup();
      const other = await signup();
      const created = await request("/api/urls", {
        method: "POST",
        sessionId: owner.sessionId,
        body: { originalUrl: "https://example.com/keep-cache" },
      });

      const redirect = await fetch(`${baseUrl}/${created.body.shortCode}`, {
        redirect: "manual",
      });
      assert.equal(redirect.status, 302);

      const cacheKey = urlCacheKey(created.body.shortCode);
      assert.equal(await redisClient.get(cacheKey), "https://example.com/keep-cache");

      const res = await request(`/api/urls/${created.body.id}`, {
        method: "DELETE",
        sessionId: other.sessionId,
      });

      assert.equal(res.status, 404);
      assert.equal(await redisClient.get(cacheKey), "https://example.com/keep-cache");
    });

    it("redirect endpoint returns 404 after the URL has been successfully deleted", async () => {
      const { sessionId } = await signup();
      const created = await request("/api/urls", {
        method: "POST",
        sessionId,
        body: { originalUrl: "https://example.com/gone" },
      });

      await fetch(`${baseUrl}/${created.body.shortCode}`, {
        redirect: "manual",
      });

      const deleted = await request(`/api/urls/${created.body.id}`, {
        method: "DELETE",
        sessionId,
      });
      assert.equal(deleted.status, 204);

      const redirect = await fetch(`${baseUrl}/${created.body.shortCode}`, {
        redirect: "manual",
      });
      const body = await redirect.json();

      assert.equal(redirect.status, 404);
      assert.equal(body.error, "Not found");
      assert.equal(body.message, undefined);
    });

    it("internal database/Redis errors are not exposed to the client", async () => {
      const { sessionId } = await signup();
      const created = await request("/api/urls", {
        method: "POST",
        sessionId,
        body: { originalUrl: "https://example.com/no-leak" },
      });

      const res = await request(`/api/urls/${created.body.id}`, {
        method: "DELETE",
        sessionId,
      });

      assert.equal(res.status, 204);
      assert.equal(res.body, null);
      assert.equal(res.body?.stack, undefined);
      assert.equal(res.body?.detail, undefined);
    });
  });
});
