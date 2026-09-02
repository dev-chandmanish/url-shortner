const { randomInt, randomUUID } = require("crypto");
const urlsDb = require("../db/urls");
const urlCache = require("../db/urlCache");

const SHORT_CODE_LENGTH = 6;
const SHORT_CODE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const MAX_SHORT_CODE_ATTEMPTS = 5;

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function generateShortCode(length = SHORT_CODE_LENGTH) {
  let code = "";

  for (let i = 0; i < length; i += 1) {
    code += SHORT_CODE_ALPHABET[randomInt(SHORT_CODE_ALPHABET.length)];
  }

  return code;
}

function validateOriginalUrl(originalUrl) {
  if (typeof originalUrl !== "string" || originalUrl.trim() === "") {
    throw createHttpError(400, "Original URL is required");
  }

  let parsed;

  try {
    parsed = new URL(originalUrl.trim());
  } catch {
    throw createHttpError(400, "Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw createHttpError(400, "URL must use HTTP or HTTPS");
  }

  return originalUrl.trim();
}

function buildShortUrl(shortCode) {
  const baseUrl = (process.env.BASE_URL || "http://localhost:3000").replace(
    /\/$/,
    ""
  );

  return `${baseUrl}/${shortCode}`;
}

function toUrlResponse(row) {
  return {
    id: row.id,
    shortCode: row.short_code,
    originalUrl: row.original_url,
    shortUrl: buildShortUrl(row.short_code),
  };
}

function toListUrlResponse(row) {
  return {
    id: row.id,
    shortCode: row.short_code,
    originalUrl: row.original_url,
    clickCount: row.click_count,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
    shortUrl: buildShortUrl(row.short_code),
  };
}

async function createShortUrl(
  { userId, originalUrl },
  { insertUrl = urlsDb.createUrl } = {}
) {
  const normalizedUrl = validateOriginalUrl(originalUrl);

  for (let attempt = 1; attempt <= MAX_SHORT_CODE_ATTEMPTS; attempt += 1) {
    try {
      const row = await insertUrl({
        id: randomUUID(),
        userId,
        shortCode: generateShortCode(),
        originalUrl: normalizedUrl,
      });

      return toUrlResponse(row);
    } catch (error) {
      if (error.code === "23505" && attempt < MAX_SHORT_CODE_ATTEMPTS) {
        continue;
      }

      if (error.code === "23505") {
        throw createHttpError(500, "Internal server error");
      }

      throw error;
    }
  }
}

async function listUrlsForUser(userId) {
  const rows = await urlsDb.findByUserId(userId);
  return rows.map(toListUrlResponse);
}

async function getUrlStats({ id, userId }) {
  const row = await urlsDb.findByIdAndUserId(id, userId);

  if (!row) {
    throw createHttpError(404, "Not found");
  }

  return toListUrlResponse(row);
}

async function deleteUrl(
  { id, userId },
  {
    deleteByIdAndUserId = urlsDb.deleteByIdAndUserId,
    deleteCachedUrl = urlCache.deleteCachedUrl,
  } = {}
) {
  const row = await deleteByIdAndUserId(id, userId);

  if (!row) {
    throw createHttpError(404, "Not found");
  }

  try {
    await deleteCachedUrl(row.short_code);
  } catch (error) {
    console.error(error);
  }

  return row;
}

async function resolveOriginalUrl(
  shortCode,
  {
    getCachedUrl = urlCache.getCachedUrl,
    setCachedUrl = urlCache.setCachedUrl,
    findOriginalUrlByShortCode = urlsDb.findOriginalUrlByShortCode,
  } = {}
) {
  if (typeof shortCode !== "string" || shortCode.trim() === "") {
    throw createHttpError(404, "Not found");
  }

  const code = shortCode.trim();

  try {
    const cached = await getCachedUrl(code);
    if (cached) {
      return cached;
    }
  } catch (error) {
    console.error(error);
  }

  let originalUrl;

  try {
    originalUrl = await findOriginalUrlByShortCode(code);
  } catch (error) {
    console.error(error);
    throw createHttpError(500, "Internal server error");
  }

  if (!originalUrl) {
    throw createHttpError(404, "Not found");
  }

  try {
    await setCachedUrl(code, originalUrl);
  } catch (error) {
    console.error(error);
  }

  return originalUrl;
}

module.exports = {
  SHORT_CODE_LENGTH,
  SHORT_CODE_ALPHABET,
  MAX_SHORT_CODE_ATTEMPTS,
  generateShortCode,
  createShortUrl,
  listUrlsForUser,
  getUrlStats,
  deleteUrl,
  resolveOriginalUrl,
};
