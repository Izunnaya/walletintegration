import { Router } from "express";
import TransferController from "../controllers/TransferController.ts";
import { verifyToken } from "../middleware/auth.ts";
import { validateTransferRequest, validateIdempotencyKey } from "../middleware/validate.ts";

const router = Router();
router.post("/", verifyToken, validateIdempotencyKey, validateTransferRequest, TransferController.sendTransfer);
export default router;
