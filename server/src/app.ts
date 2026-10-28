import express from "express";
import helmet from "helmet";
import { trustedProxyHops } from "./proxyConfig.ts";
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

app.set("trust proxy", trustedProxyHops);
app.disable("x-powered-by");
app.use(helmet());
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(attachRequestId);

// Before the rest. A preflight OPTIONS carries no token and no body, so it has to be
// answered before authentication or body parsing would refuse it.
app.use(corsMiddleware);

// Record parser failures with the same request ID returned to the caller.
app.use(httpLogger);

// Reads the JSON body of a request into req.body. Without this line req.body is undefined.
app.use(express.json({ limit: "16kb" }));

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
