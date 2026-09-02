const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");

require("dotenv").config();

const {
  SHORT_CODE_ALPHABET,
  SHORT_CODE_LENGTH,
  generateShortCode,
  createShortUrl,
  resolveOriginalUrl,
  deleteUrl,
} = require("../src/services/urlService");
const pool = require("../src/db/postgres");
const redisClient = require("../src/db/redis");

describe("urlService", () => {
  after(async () => {
    await pool.end();

    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  });

  it("generated short codes have the expected format", () => {
    const shortCodePattern = new RegExp(
      `^[${SHORT_CODE_ALPHABET}]{${SHORT_CODE_LENGTH}}$`
    );

    for (let i = 0; i < 20; i += 1) {
      assert.match(generateShortCode(), shortCodePattern);
    }
  });

  it("database unique constraint collisions are retried", async () => {
    let attempts = 0;

    async function insertUrl({ shortCode, originalUrl, id }) {
      attempts += 1;

      if (attempts < 3) {
        const error = new Error("duplicate short code");
        error.code = "23505";
        throw error;
      }

      return {
        id,
        short_code: shortCode,
        original_url: originalUrl,
      };
    }

    const result = await createShortUrl(
      {
        userId: "11111111-1111-1111-1111-111111111111",
        originalUrl: "https://example.com/retry",
      },
      { insertUrl }
    );

    assert.equal(attempts, 3);
    assert.equal(result.originalUrl, "https://example.com/retry");
    assert.equal(result.shortCode.length, SHORT_CODE_LENGTH);
    assert.ok(result.id);
    assert.ok(result.shortUrl.endsWith(`/${result.shortCode}`));
  });

  it("cache hit returns the original URL without querying PostgreSQL", async () => {
    let postgresQueries = 0;

    const originalUrl = await resolveOriginalUrl("AbC123", {
      getCachedUrl: async () => "https://example.com/cached",
      findOriginalUrlByShortCode: async () => {
        postgresQueries += 1;
        return "https://example.com/from-db";
      },
      setCachedUrl: async () => {
        throw new Error("cache should not be written on a hit");
      },
    });

    assert.equal(originalUrl, "https://example.com/cached");
    assert.equal(postgresQueries, 0);
  });

  it("cache miss queries PostgreSQL and populates Redis", async () => {
    let postgresQueries = 0;
    let cachedValue;

    const originalUrl = await resolveOriginalUrl("AbC123", {
      getCachedUrl: async () => null,
      findOriginalUrlByShortCode: async (shortCode) => {
        postgresQueries += 1;
        assert.equal(shortCode, "AbC123");
        return "https://example.com/from-db";
      },
      setCachedUrl: async (shortCode, value) => {
        cachedValue = { shortCode, value };
      },
    });

    assert.equal(originalUrl, "https://example.com/from-db");
    assert.equal(postgresQueries, 1);
    assert.deepEqual(cachedValue, {
      shortCode: "AbC123",
      value: "https://example.com/from-db",
    });
  });

  it("Redis failure falls back to PostgreSQL", async () => {
    const originalUrl = await resolveOriginalUrl("AbC123", {
      getCachedUrl: async () => {
        throw new Error("redis down");
      },
      findOriginalUrlByShortCode: async () => "https://example.com/from-db",
      setCachedUrl: async () => {
        throw new Error("redis still down");
      },
    });

    assert.equal(originalUrl, "https://example.com/from-db");
  });

  it("Redis is NOT invalidated when PostgreSQL deletion fails", async () => {
    let cacheDeletes = 0;

    await assert.rejects(
      () =>
        deleteUrl(
          {
            id: "11111111-1111-1111-1111-111111111111",
            userId: "22222222-2222-2222-2222-222222222222",
          },
          {
            deleteByIdAndUserId: async () => null,
            deleteCachedUrl: async () => {
              cacheDeletes += 1;
            },
          }
        ),
      (error) => error.statusCode === 404
    );

    assert.equal(cacheDeletes, 0);
  });

  it("internal Redis errors are not thrown after a successful delete", async () => {
    const row = await deleteUrl(
      {
        id: "11111111-1111-1111-1111-111111111111",
        userId: "22222222-2222-2222-2222-222222222222",
      },
      {
        deleteByIdAndUserId: async () => ({
          id: "11111111-1111-1111-1111-111111111111",
          short_code: "AbC123",
        }),
        deleteCachedUrl: async () => {
          throw new Error("redis del failed");
        },
      }
    );

    assert.equal(row.short_code, "AbC123");
  });
});
