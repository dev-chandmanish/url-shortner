const { randomUUID } = require("crypto");
const redisClient = require("./redis");

const CLICK_KEY_PREFIX = "clicks:";
const CLAIMED_KEY_PREFIX = "click_batch:";

function clickKey(shortCode) {
  return `${CLICK_KEY_PREFIX}${shortCode}`;
}

function claimedBatchKey(batchId, shortCode) {
  return `${CLAIMED_KEY_PREFIX}${batchId}:${shortCode}`;
}

function parseClaimedKey(key) {
  const rest = key.slice(CLAIMED_KEY_PREFIX.length);
  const separatorIndex = rest.indexOf(":");
  if (separatorIndex === -1) {
    return null;
  }

  return {
    claimedKey: key,
    batchId: rest.slice(0, separatorIndex),
    shortCode: rest.slice(separatorIndex + 1),
  };
}

function isMissingKeyError(error) {
  const message = String(error?.message ?? "");
  return message.includes("no such key");
}

async function incrementClick(shortCode) {
  return redisClient.incr(clickKey(shortCode));
}

async function getClickCount(shortCode) {
  const value = await redisClient.get(clickKey(shortCode));
  return value === null ? 0 : Number(value);
}

async function scanKeys(match) {
  const keys = [];

  // node-redis v6 scanIterator yields one SCAN page (string[]) per iteration,
  // not a single key. Passing that array into RENAME/GET/DEL makes the RESP
  // encoder throw: arguments[1] must be string | Buffer, got object.
  for await (const page of redisClient.scanIterator({ MATCH: match })) {
    if (Array.isArray(page)) {
      keys.push(...page);
    } else if (typeof page === "string") {
      keys.push(page);
    }
  }

  return keys;
}

async function listActiveClickKeys() {
  return scanKeys(`${CLICK_KEY_PREFIX}*`);
}

async function listClaimedBatchKeys() {
  return scanKeys(`${CLAIMED_KEY_PREFIX}*`);
}

async function claimCounter(activeKey) {
  // RENAME is atomic: it moves the accumulated count off the live key in one
  // step. GET then DEL would race with INCR and could drop clicks that arrived
  // between those commands. After RENAME, INCR recreates clicks:<shortCode>
  // for new traffic, so the active counter stays available while this batch
  // is persisted.
  const shortCode = activeKey.slice(CLICK_KEY_PREFIX.length);
  const batchId = randomUUID();
  const claimedKey = claimedBatchKey(batchId, shortCode);

  try {
    await redisClient.rename(activeKey, claimedKey);
  } catch (error) {
    if (isMissingKeyError(error)) {
      return null;
    }

    throw error;
  }

  const clickCount = Number(await redisClient.get(claimedKey));

  if (!Number.isFinite(clickCount) || clickCount <= 0) {
    await redisClient.del(claimedKey);
    return null;
  }

  return {
    batchId,
    shortCode,
    clickCount,
    claimedKey,
  };
}

async function readClaimedBatch(claimedKey) {
  const parsed = parseClaimedKey(claimedKey);
  if (!parsed) {
    return null;
  }

  const clickCount = Number(await redisClient.get(claimedKey));
  if (!Number.isFinite(clickCount) || clickCount <= 0) {
    return null;
  }

  return {
    ...parsed,
    clickCount,
  };
}

async function deleteClaimedBatch(claimedKey) {
  await redisClient.del(claimedKey);
}

module.exports = {
  CLICK_KEY_PREFIX,
  CLAIMED_KEY_PREFIX,
  clickKey,
  claimedBatchKey,
  parseClaimedKey,
  incrementClick,
  getClickCount,
  listActiveClickKeys,
  listClaimedBatchKeys,
  claimCounter,
  readClaimedBatch,
  deleteClaimedBatch,
};
