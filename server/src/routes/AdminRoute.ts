import { Router } from "express";
import AdminController from "../controllers/AdminController.ts";
import { verifyToken, requireRole } from "../middleware/auth.ts";
import { adminLimiter } from "../middleware/rateLimit.ts";
import { validateRestrictionRequest } from "../middleware/validate.ts";

const router = Router();
router.use(verifyToken, adminLimiter, requireRole("admin"));

router.post("/users/:id/block", validateRestrictionRequest, AdminController.blockUser);
router.post("/users/:id/unblock", validateRestrictionRequest, AdminController.unblockUser);
router.get("/audit", AdminController.listAuditEntries);

export default router;
