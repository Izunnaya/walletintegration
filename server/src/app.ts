import express from "express";
import { corsMiddleware } from "./middleware/cors.ts";
import { attachRequestId } from "./middleware/requestId.ts";
import { httpLogger } from "./logger.ts";
import { respondNotFound, respondInternalError } from "./middleware/errorHandler.ts";
import HealthRoute from "./routes/HealthRoute.ts";
import AuthRoute from "./routes/AuthRoute.ts";
import WalletRoute from "./routes/WalletRoute.ts";
import AdminRoute from "./routes/AdminRoute.ts";
import TransferRoute from "./routes/TransferRoute.ts";

const app = express();

// 1 rather than true, because trusting the whole chain would let a caller spoof
// X-Forwarded-For and mint a fresh rate-limit bucket per request. That part works: a
// fabricated header is ignored.
//
// The hop count is wrong for Render, though, and this is measured rather than suspected.
// Express counts hops from the right, so 1 means "take the last X-Forwarded-For entry" -
// which is the caller only while there is exactly one entry. Render adds its own, so req.ip
// is Render's edge address and the IP-keyed limiter buckets every caller together instead of
// separately. See Q32 in OPEN-QUESTIONS.md: the fix needs the real chain, which the request
// log now carries, rather than a guessed number.
app.set("trust proxy", 1);

// Before the rest. A preflight OPTIONS carries no token and no body, so it has to be
// answered before authentication or body parsing would refuse it.
app.use(corsMiddleware);

// Before express.json(), deliberately. A body that is not valid JSON fails inside the
// parser, and with the ID assigned after it that failure would be the one error a caller
// cannot quote an ID for - exactly when they most need one.
app.use(attachRequestId);

// After attachRequestId, so the automatic request line carries the same ID the caller was
// given in X-Request-Id, and before the routes, so a request is logged even when it fails
// in the body parser. One JSON line per request, written when the response finishes.
app.use(httpLogger);

// Reads the JSON body of a request into req.body. Without this line req.body is undefined.
app.use(express.json());

// Each prefix is forwarded to its router
app.use("/health", HealthRoute);
app.use("/auth", AuthRoute);
app.use("/wallets", WalletRoute);
app.use("/admin", AdminRoute);
app.use("/transfers", TransferRoute);

// These two run last. respondNotFound when no route matched, respondInternalError when a route threw
app.use(respondNotFound);
app.use(respondInternalError);

export default app;
