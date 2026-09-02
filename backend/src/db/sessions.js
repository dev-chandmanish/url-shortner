const redisClient = require("./redis");

function sessionKey(sessionId) {
  return `session:${sessionId}`;
}

async function saveSession(sessionId, userId, ttlSeconds) {
  await redisClient.set(sessionKey(sessionId), userId, { EX: ttlSeconds });
}

async function getSession(sessionId) {
  return redisClient.get(sessionKey(sessionId));
}

async function deleteSession(sessionId) {
  await redisClient.del(sessionKey(sessionId));
}

module.exports = {
  sessionKey,
  saveSession,
  getSession,
  deleteSession,
};
