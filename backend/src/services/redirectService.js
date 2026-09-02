const urlService = require("./urlService");
const clickCounterService = require("./clickCounterService");

async function getRedirectTarget(
  shortCode,
  {
    resolveOriginalUrl = urlService.resolveOriginalUrl,
    incrementClick = clickCounterService.increment,
  } = {}
) {
  const originalUrl = await resolveOriginalUrl(shortCode);

  try {
    await incrementClick(shortCode);
  } catch (error) {
    console.error(error);
  }

  return originalUrl;
}

module.exports = {
  getRedirectTarget,
};
