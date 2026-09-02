const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");

require("dotenv").config();

const { getRedirectTarget } = require("../src/services/redirectService");
const pool = require("../src/db/postgres");
const redisClient = require("../src/db/redis");

describe("redirectService", () => {
  after(async () => {
    await pool.end();

    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  });

  it("Redis click increment failure does not prevent a successful redirect", async () => {
    const originalUrl = await getRedirectTarget("AbC123", {
      resolveOriginalUrl: async () => "https://example.com/ok",
      incrementClick: async () => {
        throw new Error("redis incr failed");
      },
    });

    assert.equal(originalUrl, "https://example.com/ok");
  });
});
