const redisClient = require("./redis");

const URL_CACHE_TTL_SECONDS = 60 * 60;

function urlCacheKey(shortCode) {
  return `url:${shortCode}`;
}

async function getCachedUrl(shortCode) {
  return redisClient.get(urlCacheKey(shortCode));
}

async function setCachedUrl(shortCode, originalUrl, ttlSeconds = URL_CACHE_TTL_SECONDS) {
  await redisClient.set(urlCacheKey(shortCode), originalUrl, {
    EX: ttlSeconds,
  });
}

async function deleteCachedUrl(shortCode) {
  await redisClient.del(urlCacheKey(shortCode));
}

module.exports = {
  URL_CACHE_TTL_SECONDS,
  urlCacheKey,
  getCachedUrl,
  setCachedUrl,
  deleteCachedUrl,
};
