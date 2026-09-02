const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const urlController = require("../controllers/urlController");

const router = express.Router();

router.post("/", requireAuth, urlController.create);
router.get("/", requireAuth, urlController.list);
router.get("/:id/stats", requireAuth, urlController.stats);
router.delete("/:id", requireAuth, urlController.remove);

module.exports = router;
