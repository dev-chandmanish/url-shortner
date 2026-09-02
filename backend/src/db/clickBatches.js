const pool = require("./postgres");

async function persistClickBatch({ batchId, shortCode, clickCount }) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    try {
      // batch_id is the primary key, so a duplicate insert means this batch
      // already committed. Skip the click_count update to stay idempotent.
      await client.query(
        `INSERT INTO click_batches (batch_id, short_code, click_count)
         VALUES ($1, $2, $3)`,
        [batchId, shortCode, clickCount]
      );
    } catch (error) {
      if (error.code === "23505") {
        await client.query("ROLLBACK");
        return { duplicate: true };
      }

      throw error;
    }

    // Both statements share one transaction so a crash cannot apply the URL
    // increment without a matching click_batches row (or vice versa).
    await client.query(
      `UPDATE urls
       SET click_count = click_count + $1
       WHERE short_code = $2`,
      [clickCount, shortCode]
    );

    await client.query("COMMIT");
    return { duplicate: false };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback errors so the original failure is reported.
    }

    throw error;
  } finally {
    client.release();
  }
}

async function getUrlClickCount(shortCode) {
  const result = await pool.query(
    `SELECT click_count FROM urls WHERE short_code = $1`,
    [shortCode]
  );

  return result.rows[0]?.click_count ?? null;
}

module.exports = {
  persistClickBatch,
  getUrlClickCount,
};
