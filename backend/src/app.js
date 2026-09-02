require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const pool = require("./db/postgres");
const redisClient = require("./db/redis");
const authRoutes = require("./routes/auth");
const urlRoutes = require("./routes/urls");
const redirectRoutes = require("./routes/redirect");

const app = express();

app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/urls", urlRoutes);

app.get("/health", async (req, res) => {
  let postgres = "ok";
  let redis = "ok";

  try {
    await pool.query("SELECT 1");
  } catch {
    postgres = "unavailable";
  }

  try {
    await redisClient.ping();
  } catch {
    redis = "unavailable";
  }

  const healthy = postgres === "ok" && redis === "ok";

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    postgres,
    redis,
  });
});

app.use(redirectRoutes);

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  const clickBatchWorker = require("./workers/clickBatchWorker");

  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    clickBatchWorker.start();
  });

  const shutdown = async () => {
    clickBatchWorker.stop();

    try {
      await clickBatchWorker.flushOnce();
    } catch (error) {
      console.error(error);
    }

    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

module.exports = app;
