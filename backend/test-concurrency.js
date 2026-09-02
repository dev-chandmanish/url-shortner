const { Pool } = require("pg");
const { createClient } = require("redis");
const http = require("http");
const { URL } = require("url");
require("dotenv").config();

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const SHORT_CODE = "PqvNUK";
const TOTAL_FIRST_WAVE = 100;
const TOTAL_SECOND_WAVE = 5;
const POLL_INTERVAL_MS = 100;
const CLAIM_TIMEOUT_MS = 15000;

const pool = new Pool({
host: process.env.DB_HOST,
port: Number(process.env.DB_PORT),
database: process.env.DB_NAME,
user: process.env.DB_USER,
password: process.env.DB_PASSWORD,
});

const redis = createClient({
socket: {
host: process.env.REDIS_HOST,
port: Number(process.env.REDIS_PORT),
},
});

async function sleep(ms) {
return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getPostgresClickCount() {
const result = await pool.query(
"SELECT click_count FROM urls WHERE short_code = $1",
[SHORT_CODE]
);

if (result.rowCount === 0) {
throw new Error(`URL ${SHORT_CODE} does not exist`);
}

return result.rows[0].click_count;
}

async function getRedisCounter() {
const value = await redis.get(`clicks:${SHORT_CODE}`);
return value === null ? 0 : Number(value);
}

async function sendRedirectRequest() {
  const url = new URL(`${BASE_URL}/${SHORT_CODE}`);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: "GET",
        timeout: 10_000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      }
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timed out: GET ${url.href}`));
    });

    req.on("error", (error) => {
      reject(error);
    });

    req.end();
  });
}

async function sendRedirectRequests(count) {
  let success = 0;

  const requests = Array.from({ length: count }, async () => {
    const status = await sendRedirectRequest();

    if (status === 302) {
      success += 1;
    }

    return status;
  });

  await Promise.all(requests);

  return success;
}

async function waitForClaim(expectedCount) {
  const key = `test:click-batch-claimed:${SHORT_CODE}`;
  const deadline = Date.now() + CLAIM_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const value = await redis.get(key);

    if (value) {
      const data = JSON.parse(value);

      if (
        data.shortCode === SHORT_CODE &&
        Number(data.count) === expectedCount
      ) {
        return data;
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }

  const signalValue = await redis.get(key);
  const activeCounter = await redis.get(`clicks:${SHORT_CODE}`);
  const testKeys = [];

  for await (const page of redis.scanIterator({
    MATCH: "test:click-batch-claimed:*",
  })) {
    if (Array.isArray(page)) {
      testKeys.push(...page);
    } else if (typeof page === "string") {
      testKeys.push(page);
    }
  }

  throw new Error(
    [
      `Timed out waiting for claimed batch of ${expectedCount}.`,
      `test signal key existed: ${signalValue !== null}`,
      `test signal value: ${signalValue}`,
      `clicks:${SHORT_CODE} = ${activeCounter}`,
      `test:click-batch-claimed:* keys: ${testKeys.join(", ") || "(none)"}`,
    ].join("\n")
  );
}

async function waitForPostgresCount(expectedCount, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const current = await getPostgresClickCount();

    if (current === expectedCount) {
      return current;
    }

    await sleep(250);
  }

  const current = await getPostgresClickCount();

  throw new Error(
    `Timed out waiting for PostgreSQL count ${expectedCount}. Current count: ${current}`
  );
}

async function getBatches() {
const result = await pool.query(
`     SELECT batch_id, short_code, click_count, created_at
    FROM click_batches
    WHERE short_code = $1
    ORDER BY created_at DESC
    LIMIT 10
    `,
[SHORT_CODE]
);

return result.rows;
}

async function main() {
console.log("=== CLICK-BATCH CONCURRENCY TEST ===\n");

await redis.connect();

// ------------------------------------------------------------
// 1. Read baseline
// ------------------------------------------------------------

console.log("1. Reading initial PostgreSQL click_count...");

const initialCount = await getPostgresClickCount();

console.log(`Initial PostgreSQL count: ${initialCount}\n`);

// ------------------------------------------------------------
// 2. Clean the active test counter
// ------------------------------------------------------------

console.log("2. Cleaning active Redis counter...");

await redis.del(`clicks:${SHORT_CODE}`);

console.log("Deleted clicks:" + SHORT_CODE + "\n");

// ------------------------------------------------------------
// 3. First wave — 100 clicks
// ------------------------------------------------------------

console.log(
`3. Sending ${TOTAL_FIRST_WAVE} redirect requests...`
);

const firstWaveSuccess = await sendRedirectRequests(
TOTAL_FIRST_WAVE
);

console.log(
`302 responses: ${firstWaveSuccess}/${TOTAL_FIRST_WAVE}`
);

if (firstWaveSuccess !== TOTAL_FIRST_WAVE) {
throw new Error("First wave did not produce 100 successful redirects");
}

// ------------------------------------------------------------
// 4. Verify Redis has 100 clicks
// ------------------------------------------------------------

console.log("\n4. Checking Redis counter...");

const firstRedisCount = await getRedisCounter();

console.log(
`clicks:${SHORT_CODE} = ${firstRedisCount}`
);

if (firstRedisCount !== TOTAL_FIRST_WAVE) {
throw new Error(
`Expected Redis counter ${TOTAL_FIRST_WAVE}, got ${firstRedisCount}`
);
}

console.log("PASS: Redis contains exactly 100 clicks.");

// ------------------------------------------------------------
// 5. Wait for worker to atomically claim the 100
// ------------------------------------------------------------

console.log(
"\n5. Waiting for worker to claim the 100-click batch..."
);

const claimedBatch = await waitForClaim(TOTAL_FIRST_WAVE);

console.log("PASS: Worker claimed the batch.");
console.log(`  batchId: ${claimedBatch.batchId}`);
console.log(`  shortCode: ${claimedBatch.shortCode}`);
console.log(`  count: ${claimedBatch.count}`);

// ------------------------------------------------------------
// 6. Immediately send 5 new clicks
// ------------------------------------------------------------

console.log(
`\n6. Sending ${TOTAL_SECOND_WAVE} NEW clicks during the worker's 5-second delay...`
);

const secondWaveSuccess = await sendRedirectRequests(
TOTAL_SECOND_WAVE
);

console.log(
`302 responses: ${secondWaveSuccess}/${TOTAL_SECOND_WAVE}`
);

if (secondWaveSuccess !== TOTAL_SECOND_WAVE) {
throw new Error("Second wave did not produce 5 successful redirects");
}

// ------------------------------------------------------------
// 7. Verify the 5 new clicks remain in active Redis counter
// ------------------------------------------------------------

console.log("\n7. Checking active Redis counter...");

const secondRedisCount = await getRedisCounter();

console.log(
`clicks:${SHORT_CODE} = ${secondRedisCount}`
);

if (secondRedisCount !== TOTAL_SECOND_WAVE) {
throw new Error(
`Expected active Redis counter ${TOTAL_SECOND_WAVE}, got ${secondRedisCount}`
);
}

console.log(
"PASS: New clicks were kept in the active Redis counter."
);

// ------------------------------------------------------------
// 8. Wait for first batch to reach PostgreSQL
// ------------------------------------------------------------

console.log(
"\n8. Waiting for the first batch to be persisted..."
);

const expectedAfterFirstBatch =
initialCount + TOTAL_FIRST_WAVE;

await waitForPostgresCount(expectedAfterFirstBatch);

console.log(
`PASS: PostgreSQL count is ${expectedAfterFirstBatch}.`
);

// ------------------------------------------------------------
// 9. Confirm Redis still has the second wave
// ------------------------------------------------------------

const redisAfterFirstBatch = await getRedisCounter();

console.log(
`Redis active counter after first batch: ${redisAfterFirstBatch}`
);

if (redisAfterFirstBatch !== TOTAL_SECOND_WAVE) {
throw new Error(
`Expected Redis to retain ${TOTAL_SECOND_WAVE} clicks, got ${redisAfterFirstBatch}`
);
}

console.log(
"PASS: The 5 concurrent clicks were NOT deleted by the first batch."
);

// ------------------------------------------------------------
// 10. Wait for second batch
// ------------------------------------------------------------

console.log(
"\n9. Waiting for the second batch to be persisted..."
);

const expectedFinalCount =
initialCount + TOTAL_FIRST_WAVE + TOTAL_SECOND_WAVE;

await waitForPostgresCount(expectedFinalCount);

console.log(
`PASS: PostgreSQL final count is ${expectedFinalCount}.`
);

// ------------------------------------------------------------
// 11. Verify Redis is empty
// ------------------------------------------------------------

const finalRedisCount = await getRedisCounter();

console.log(
`Final Redis counter: ${finalRedisCount}`
);

if (finalRedisCount !== 0) {
throw new Error(
`Expected Redis counter to be 0, got ${finalRedisCount}`
);
}

console.log("PASS: Redis active counter is empty.");

// ------------------------------------------------------------
// 12. Show recent batches
// ------------------------------------------------------------

console.log("\n10. Recent click batches:");

const batches = await getBatches();

for (const batch of batches) {
console.log(
`  ${batch.batch_id} | ${batch.short_code} | ${batch.click_count} clicks | ${batch.created_at}`
);
}

// ------------------------------------------------------------
// Final result
// ------------------------------------------------------------

console.log("\n========================================");
console.log("          CONCURRENCY TEST PASSED");
console.log("========================================");
console.log(`Initial PostgreSQL count : ${initialCount}`);
console.log(`First batch              : +${TOTAL_FIRST_WAVE}`);
console.log(`Concurrent clicks        : +${TOTAL_SECOND_WAVE}`);
console.log(`Expected final count     : ${expectedFinalCount}`);
console.log(`Actual final count       : ${expectedFinalCount}`);
console.log("New clicks were preserved during batch processing.");
console.log("========================================\n");
}

main()
.catch((error) => {
console.error("\n========================================");
console.error("          CONCURRENCY TEST FAILED");
console.error("========================================");
console.error(error && error.message ? error.message : error);
if (error && error.stack) {
  console.error(error.stack);
}
console.error("========================================\n");
process.exitCode = 1;
})
.finally(async () => {
await redis.quit().catch(() => {});
await pool.end().catch(() => {});
});
