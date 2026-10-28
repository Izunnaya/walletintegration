import { Router } from "express";
import TransferController from "../controllers/TransferController.ts";
import { verifyToken } from "../middleware/auth.ts";
import { validateTransferRequest, validateIdempotencyKey, validateTransferHistoryQuery } from "../middleware/validate.ts";
import TransferHistoryController from "../controllers/TransferHistoryController.ts";

const router = Router();
router.post("/", verifyToken, validateIdempotencyKey, validateTransferRequest, TransferController.sendTransfer);
router.get("/", verifyToken, validateTransferHistoryQuery, TransferHistoryController.listTransfers);
router.get("/:id", verifyToken, TransferHistoryController.getTransfer);

export default router;
