const pool = require("./postgres");

async function createUser({ id, email, passwordHash }) {
  const result = await pool.query(
    `INSERT INTO users (id, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, email`,
    [id, email, passwordHash]
  );

  return result.rows[0];
}

async function findById(id) {
  const result = await pool.query(
    `SELECT id, email
     FROM users
     WHERE id = $1`,
    [id]
  );

  return result.rows[0] ?? null;
}

async function findByEmail(email) {
  const result = await pool.query(
    `SELECT id, email, password_hash AS "passwordHash"
     FROM users
     WHERE email = $1`,
    [email]
  );

  return result.rows[0] ?? null;
}

module.exports = {
  createUser,
  findById,
  findByEmail,
};
