// FIRST, and it must stay first.
//
// ES modules evaluate every import before the body of this file runs, so a plain
// dotenv.config() call below would execute AFTER the route modules had already loaded -
// and models/db.ts reads DATABASE_URL at import time and throws without it. Importing
// "dotenv/config" runs the load as a side effect of the import itself, and imports are
// evaluated in source order, so the environment is populated before anything needs it.
import "dotenv/config";
import express from "express";
import { attachRequestId } from "./middleware/requestId.ts";
import { respondNotFound, respondInternalError } from "./middleware/errorHandler.ts";
import HealthRoute from "./routes/HealthRoute.ts";
import AuthRoute from "./routes/AuthRoute.ts";
import WalletRoute from "./routes/WalletRoute.ts";

const app = express();
const PORT = process.env.PORT || 3000;

// Reads the JSON body of a request into req.body. Without this line req.body is undefined.
app.use(express.json());

// Gives every request an ID, returned in the X-Request-Id header and in any error response,
// so a user reporting a failed transfer gives us an ID we can find in the logs
app.use(attachRequestId);

// Each prefix is forwarded to its router
app.use("/health", HealthRoute);
app.use("/auth", AuthRoute);
app.use("/wallets", WalletRoute);

// These two run last. respondNotFound when no route matched, respondInternalError when a route threw
app.use(respondNotFound);
app.use(respondInternalError);

app.listen(PORT, () => {
  console.log(`Server started on localhost:${PORT}`);
});
