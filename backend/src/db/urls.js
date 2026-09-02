const pool = require("./postgres");

async function createUrl({ id, userId, shortCode, originalUrl }) {
  const result = await pool.query(
    `INSERT INTO urls (id, user_id, short_code, original_url)
     VALUES ($1, $2, $3, $4)
     RETURNING id, short_code, original_url`,
    [id, userId, shortCode, originalUrl]
  );

  return result.rows[0];
}

async function findByUserId(userId) {
  const result = await pool.query(
    `SELECT id, short_code, original_url, click_count, created_at
     FROM urls
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  return result.rows;
}

async function findOriginalUrlByShortCode(shortCode) {
  const result = await pool.query(
    `SELECT original_url FROM urls WHERE short_code = $1`,
    [shortCode]
  );

  return result.rows[0]?.original_url ?? null;
}

async function findByIdAndUserId(id, userId) {
  const result = await pool.query(
    `SELECT id, short_code, original_url, click_count, created_at
     FROM urls
     WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );

  return result.rows[0] ?? null;
}

async function deleteByIdAndUserId(id, userId) {
  const result = await pool.query(
    `DELETE FROM urls
     WHERE id = $1 AND user_id = $2
     RETURNING id, short_code`,
    [id, userId]
  );

  return result.rows[0] ?? null;
}

module.exports = {
  createUrl,
  findByUserId,
  findOriginalUrlByShortCode,
  findByIdAndUserId,
  deleteByIdAndUserId,
};
