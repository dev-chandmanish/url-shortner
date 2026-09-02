const { createClient } = require("redis");

const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
  },
});

redisClient.on("error", (error) => {
  console.error("Redis connection error:", error);
});

redisClient.connect().catch((error) => {
  console.error("Failed to connect to Redis:", error);
});

module.exports = redisClient;
