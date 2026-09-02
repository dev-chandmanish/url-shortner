const clickCounters = require("../db/clickCounters");

async function increment(shortCode) {
  return clickCounters.incrementClick(shortCode);
}

async function incrementSafely(shortCode) {
  try {
    await increment(shortCode);
  } catch (error) {
    console.error(error);
  }
}

module.exports = {
  increment,
  incrementSafely,
};
