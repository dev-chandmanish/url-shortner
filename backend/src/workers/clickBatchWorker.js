const clickCounters = require("../db/clickCounters");
const clickBatches = require("../db/clickBatches");

const FLUSH_INTERVAL_MS = 10_000;

let timer = null;
let flushing = false;

async function persistClaimed(claimed, persist = clickBatches.persistClickBatch) {
  const result = await persist({
    batchId: claimed.batchId,
    shortCode: claimed.shortCode,
    clickCount: claimed.clickCount,
  });

  // Only drop the claimed Redis key after a successful persist or an
  // idempotent duplicate. A failed transaction must leave the key so the
  // count can be retried without being lost.
  await clickCounters.deleteClaimedBatch(claimed.claimedKey);
  return result;
}

async function flushOnce({ persist = clickBatches.persistClickBatch } = {}) {
  const claimedKeys = await clickCounters.listClaimedBatchKeys();

  for (const claimedKey of claimedKeys) {
    const claimed = await clickCounters.readClaimedBatch(claimedKey);
    if (!claimed) {
      continue;
    }

    try {
      await persistClaimed(claimed, persist);
    } catch (error) {
      // Leave the claimed Redis key in place so the batch can be retried.
      console.error(error);
    }
  }

  const activeKeys = await clickCounters.listActiveClickKeys();

  for (const activeKey of activeKeys) {
    let claimed;

    try {
      claimed = await clickCounters.claimCounter(activeKey);
    } catch (error) {
      console.error(error);
      continue;
    }

    if (!claimed) {
      continue;
    }

    try {
      await persistClaimed(claimed, persist);
    } catch (error) {
      console.error(error);
    }
  }
}

async function runFlush() {
  if (flushing) {
    return;
  }

  flushing = true;

  try {
    await flushOnce();
  } catch (error) {
    console.error(error);
  } finally {
    flushing = false;
  }
}

function start(intervalMs = FLUSH_INTERVAL_MS) {
  if (timer) {
    return;
  }

  timer = setInterval(() => {
    runFlush().catch((error) => {
      console.error(error);
    });
  }, intervalMs);
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  FLUSH_INTERVAL_MS,
  flushOnce,
  runFlush,
  start,
  stop,
};
