import express from "express";
import WalletController from "../controllers/WalletController.ts";
import { verifyToken } from "../middleware/auth.ts";
import { readLimiter } from "../middleware/rateLimit.ts";

const router = express.Router();

// Mounted at /wallets in index.ts. authenticate, then controller: there is no authorise
// step because the route only ever returns the caller's own wallet, and no body to validate.
router.get("/me", verifyToken, readLimiter, WalletController.getMyWallet);

export default router;
