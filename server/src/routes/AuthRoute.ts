import express from "express";
import AuthController from "../controllers/AuthController.ts";
import { validateRegisterRequest, validateLoginRequest } from "../middleware/validate.ts";
import { authLimiter, loginAccountCeiling, loginAccountLimiter } from "../middleware/rateLimit.ts";

const router = express.Router();

router.post("/register", authLimiter, validateRegisterRequest, AuthController.createUser);
router.post("/login", authLimiter, validateLoginRequest, loginAccountLimiter, loginAccountCeiling, AuthController.createSession);

export default router;
