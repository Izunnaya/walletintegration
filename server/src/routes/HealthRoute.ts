import express from "express";
import HealthController from "../controllers/HealthController.ts";

const router = express.Router();

// Mounted at /health in index.ts, so this responds on /health/live
router.get("/live", HealthController.getLiveness);
router.get("/ready", HealthController.getReadiness);

export default router;
