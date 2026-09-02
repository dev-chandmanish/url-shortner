const { randomUUID } = require("crypto");
const bcrypt = require("bcrypt");
const usersDb = require("../db/users");
const sessionService = require("./sessionService");

const SALT_ROUNDS = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateSignup({ email, password }) {
  if (typeof email !== "string" || email.trim() === "") {
    throw createHttpError(400, "Email is required");
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (!EMAIL_PATTERN.test(normalizedEmail)) {
    throw createHttpError(400, "Invalid email");
  }

  if (typeof password !== "string" || password === "") {
    throw createHttpError(400, "Password is required");
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw createHttpError(
      400,
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
    );
  }

  return { email: normalizedEmail, password };
}

async function signup({ email, password }) {
  const credentials = validateSignup({ email, password });
  const id = randomUUID();
  const passwordHash = await bcrypt.hash(credentials.password, SALT_ROUNDS);

  try {
    const user = await usersDb.createUser({
      id,
      email: credentials.email,
      passwordHash,
    });
    const sessionId = await sessionService.createSession(user.id);

    return {
      id: user.id,
      email: user.email,
      sessionId,
    };
  } catch (error) {
    if (error.code === "23505") {
      throw createHttpError(409, "Email already registered");
    }

    throw error;
  }
}

async function getCurrentUser(userId) {
  return usersDb.findById(userId);
}

async function login({ email, password }) {
  if (typeof email !== "string" || email.trim() === "") {
    throw createHttpError(400, "Email is required");
  }

  if (typeof password !== "string" || password === "") {
    throw createHttpError(400, "Password is required");
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = await usersDb.findByEmail(normalizedEmail);
  const passwordMatches = user
    ? await bcrypt.compare(password, user.passwordHash)
    : false;

  if (!user || !passwordMatches) {
    throw createHttpError(401, "Invalid email or password");
  }

  const sessionId = await sessionService.createSession(user.id);

  return {
    id: user.id,
    email: user.email,
    sessionId,
  };
}

module.exports = {
  signup,
  login,
  getCurrentUser,
};
