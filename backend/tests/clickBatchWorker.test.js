const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("crypto");

require("dotenv").config();

const pool = require("../src/db/postgres");
const redisClient = require("../src/db/redis");
const clickCounters = require("../src/db/clickCounters");
const clickBatches = require("../src/db/clickBatches");
const clickBatchWorker = require("../src/workers/clickBatchWorker");

async function seedUrl(shortCode) {
  const userId = randomUUID();
  const urlId = randomUUID();

  await pool.query(
    `INSERT INTO users (id, email, password_hash)
     VALUES ($1, $2, $3)`,
    [userId, `clicks-${userId}@example.com`, "unused-hash"]
  );

  await pool.query(
    `INSERT INTO urls (id, user_id, short_code, original_url)
     VALUES ($1, $2, $3, $4)`,
    [urlId, userId, shortCode, "https://example.com/batched"]
  );

  return shortCode;
}

describe("click batch worker", () => {
  before(async () => {
    await pool.query("SELECT 1");
    await redisClient.ping();
  });

  after(async () => {
    await pool.end();

    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  });

  it("worker claims and persists accumulated clicks", async () => {
    const shortCode = `c${randomUUID().replace(/-/g, "").slice(0, 5)}`;
    await seedUrl(shortCode);
    await redisClient.set(clickCounters.clickKey(shortCode), "7");

    await clickBatchWorker.flushOnce();

    assert.equal(await clickCounters.getClickCount(shortCode), 0);
    assert.equal(await clickBatches.getUrlClickCount(shortCode), 7);
  });

  it("new clicks arriving during batch processing are not lost", async () => {
    const shortCode = `n${randomUUID().replace(/-/g, "").slice(0, 5)}`;
    await seedUrl(shortCode);
    await redisClient.set(clickCounters.clickKey(shortCode), "100");

    const claimed = await clickCounters.claimCounter(
      clickCounters.clickKey(shortCode)
    );

    assert.equal(claimed.clickCount, 100);
    await redisClient.incrBy(clickCounters.clickKey(shortCode), 5);
    assert.equal(await clickCounters.getClickCount(shortCode), 5);

    await clickBatches.persistClickBatch(claimed);
    await clickCounters.deleteClaimedBatch(claimed.claimedKey);

    assert.equal(await clickBatches.getUrlClickCount(shortCode), 100);
    assert.equal(await clickCounters.getClickCount(shortCode), 5);

    await clickBatchWorker.flushOnce();
    assert.equal(await clickBatches.getUrlClickCount(shortCode), 105);
  });

  it("PostgreSQL failure causes the batch to remain retryable", async () => {
    const shortCode = `f${randomUUID().replace(/-/g, "").slice(0, 5)}`;
    await seedUrl(shortCode);
    await redisClient.set(clickCounters.clickKey(shortCode), "4");

    const claimed = await clickCounters.claimCounter(
      clickCounters.clickKey(shortCode)
    );

    await assert.rejects(
      clickBatches.persistClickBatch({
        ...claimed,
        clickCount: 0,
      })
    );

    assert.equal(await redisClient.get(claimed.claimedKey), "4");
    assert.equal(await clickBatches.getUrlClickCount(shortCode), 0);

    await clickBatchWorker.flushOnce();
    assert.equal(await clickBatches.getUrlClickCount(shortCode), 4);
    assert.equal(await redisClient.get(claimed.claimedKey), null);
  });

  it("retrying the same batch_id does not double-count clicks", async () => {
    const shortCode = `d${randomUUID().replace(/-/g, "").slice(0, 5)}`;
    await seedUrl(shortCode);

    const batch = {
      batchId: randomUUID(),
      shortCode,
      clickCount: 3,
    };

    const first = await clickBatches.persistClickBatch(batch);
    const second = await clickBatches.persistClickBatch(batch);

    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(await clickBatches.getUrlClickCount(shortCode), 3);
  });

  it("multiple batches for the same short code accumulate correctly", async () => {
    const shortCode = `m${randomUUID().replace(/-/g, "").slice(0, 5)}`;
    await seedUrl(shortCode);

    await clickBatches.persistClickBatch({
      batchId: randomUUID(),
      shortCode,
      clickCount: 10,
    });
    await clickBatches.persistClickBatch({
      batchId: randomUUID(),
      shortCode,
      clickCount: 5,
    });

    assert.equal(await clickBatches.getUrlClickCount(shortCode), 15);
  });
});
