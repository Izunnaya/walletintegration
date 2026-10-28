import express from "express";
import { corsMiddleware } from "./middleware/cors.ts";
import { attachRequestId } from "./middleware/requestId.ts";
import { respondNotFound, respondInternalError } from "./middleware/errorHandler.ts";
import HealthRoute from "./routes/HealthRoute.ts";
import AuthRoute from "./routes/AuthRoute.ts";
import WalletRoute from "./routes/WalletRoute.ts";
import AdminRoute from "./routes/AdminRoute.ts";
import TransferRoute from "./routes/TransferRoute.ts";

const app = express();

// Render puts one proxy in front of the service, so req.ip would otherwise be the proxy on
// every request - and the auth limiter, which is keyed by IP, would lock every caller out
// together. 1 rather than true: trusting the whole chain would let a caller spoof
// X-Forwarded-For and get a fresh bucket per request.
app.set("trust proxy", 1);

// Before the rest. A preflight OPTIONS carries no token and no body, so it has to be
// answered before authentication or body parsing would refuse it.
app.use(corsMiddleware);

// Before express.json(), deliberately. A body that is not valid JSON fails inside the
// parser, and with the ID assigned after it that failure would be the one error a caller
// cannot quote an ID for - exactly when they most need one.
app.use(attachRequestId);

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
