import express from "express";
import { attachRequestId } from "./middleware/requestId.ts";
import { respondNotFound, respondInternalError } from "./middleware/errorHandler.ts";
import HealthRoute from "./routes/HealthRoute.ts";
import AuthRoute from "./routes/AuthRoute.ts";
import WalletRoute from "./routes/WalletRoute.ts";
import AdminRoute from "./routes/AdminRoute.ts";
import TransferRoute from "./routes/TransferRoute.ts";

const app = express();

// FIRST of the two, deliberately. A body that is not valid JSON fails inside
// express.json(), and if the ID were assigned after it, that failure would be the one error
// a caller cannot quote an ID for - which is exactly when they most need to.
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
