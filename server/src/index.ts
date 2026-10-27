import dotenv from "dotenv";
import express from "express";
import { attachRequestId } from "./middleware/requestId.ts";
import { respondNotFound, respondInternalError } from "./middleware/errorHandler.ts";
import HealthRoute from "./routes/HealthRoute.ts";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Reads the JSON body of a request into req.body. Without this line req.body is undefined.
app.use(express.json());

// Gives every request an ID, returned in the X-Request-Id header and in any error response,
// so a user reporting a failed transfer gives us an ID we can find in the logs
app.use(attachRequestId);

// Once a request comes in on /health, it gets forwarded to "HealthRoute"
app.use("/health", HealthRoute);

// These two run last. respondNotFound when no route matched, respondInternalError when a route threw
app.use(respondNotFound);
app.use(respondInternalError);

app.listen(PORT, () => {
  console.log(`Server started on localhost:${PORT}`);
});
