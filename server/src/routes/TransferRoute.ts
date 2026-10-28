import { Router } from "express";
import TransferController from "../controllers/TransferController.ts";
import { verifyToken } from "../middleware/auth.ts";
import { validateTransferRequest, validateIdempotencyKey, validateTransferHistoryQuery } from "../middleware/validate.ts";
import { transferLimiter, readLimiter } from "../middleware/rateLimit.ts";
import TransferHistoryController from "../controllers/TransferHistoryController.ts";

const router = Router();
router.post("/", verifyToken, transferLimiter, validateIdempotencyKey, validateTransferRequest, TransferController.sendTransfer);
router.get("/", verifyToken, readLimiter, validateTransferHistoryQuery, TransferHistoryController.listTransfers);
router.get("/:id", verifyToken, readLimiter, TransferHistoryController.getTransfer);

export default router;
