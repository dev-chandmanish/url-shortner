const { createClient } = require("redis");

const redisOptions = {
  socket: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
  },
};

if (process.env.REDIS_PASSWORD) {
  redisOptions.password = process.env.REDIS_PASSWORD;
}

const redisClient = createClient(redisOptions);

redisClient.on("error", (error) => {
  console.error("Redis connection error:", error);
});

redisClient.connect().catch((error) => {
  console.error("Failed to connect to Redis:", error);
});

module.exports = redisClient;
