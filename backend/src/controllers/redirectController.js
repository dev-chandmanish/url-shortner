const redirectService = require("../services/redirectService");

async function redirect(req, res) {
  try {
    const originalUrl = await redirectService.getRedirectTarget(
      req.params.shortCode
    );
    res.redirect(302, originalUrl);
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ error: "Not found" });
    }

    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = {
  redirect,
};
