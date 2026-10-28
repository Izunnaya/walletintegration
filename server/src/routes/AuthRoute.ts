import express from "express";
import AuthController from "../controllers/AuthController.ts";
import { validateRegisterRequest, validateLoginRequest } from "../middleware/validate.ts";
import { authLimiter } from "../middleware/rateLimit.ts";

const router = express.Router();

// Mounted at /auth in index.ts. Both routes are public; the order inside each is
// validate then controller, because there is nobody to authenticate yet.
router.post("/register", authLimiter, validateRegisterRequest, AuthController.createUser);
router.post("/login", authLimiter, validateLoginRequest, AuthController.createSession);

export default router;
