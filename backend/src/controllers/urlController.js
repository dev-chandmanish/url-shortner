const urlService = require("../services/urlService");

async function create(req, res) {
  try {
    const { originalUrl } = req.body ?? {};
    const url = await urlService.createShortUrl({
      userId: req.user.id,
      originalUrl,
    });

    res.status(201).json({
      id: url.id,
      shortCode: url.shortCode,
      originalUrl: url.originalUrl,
      shortUrl: url.shortUrl,
    });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ error: error.message });
    }

    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
}

async function list(req, res) {
  try {
    const urls = await urlService.listUrlsForUser(req.user.id);
    res.status(200).json(urls);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
}

async function stats(req, res) {
  try {
    const url = await urlService.getUrlStats({
      id: req.params.id,
      userId: req.user.id,
    });

    res.status(200).json({
      id: url.id,
      shortCode: url.shortCode,
      originalUrl: url.originalUrl,
      shortUrl: url.shortUrl,
      clickCount: url.clickCount,
      createdAt: url.createdAt,
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ error: "Not found" });
    }

    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
}

async function remove(req, res) {
  try {
    await urlService.deleteUrl({
      id: req.params.id,
      userId: req.user.id,
    });

    res.status(204).end();
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ error: "Not found" });
    }

    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = {
  create,
  list,
  stats,
  remove,
};
