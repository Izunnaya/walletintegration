import { Router } from "express";
import AdminController from "../controllers/AdminController.ts";
import { verifyToken, requireRole } from "../middleware/auth.ts";
import { validateRestrictionRequest } from "../middleware/validate.ts";

const router = Router();

// authenticate, authorise, validate, controller - in that order, every time. Authenticating
// after authorising would mean deciding a role from a token nobody had verified.
router.post("/users/:id/block", verifyToken, requireRole("admin"), validateRestrictionRequest, AdminController.blockUser);
router.post("/users/:id/unblock", verifyToken, requireRole("admin"), validateRestrictionRequest, AdminController.unblockUser);
router.get("/audit", verifyToken, requireRole("admin"), AdminController.listAuditEntries);

export default router;
