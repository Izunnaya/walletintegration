import cors from "cors";
import type { CorsOptions } from "cors";

function allowedOrigins(): string[] {
  const configured = process.env.CORS_ORIGINS;

  if (configured) {
    return configured
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  }

  // Local development defaults. Both ports because Next defaults to 3000 and so does this
  // API, so the UI usually ends up on 3001.
  return ["http://localhost:3000", "http://localhost:3001"];
}

const origins = allowedOrigins();

const options: CorsOptions = {
  origin(origin, callback) {
    // No Origin header at all means a non-browser caller — curl, a server, a health check.
    // CORS is a browser mechanism, so there is nothing to enforce and nothing to refuse.
    if (!origin) {
      callback(null, true);
      return;
    }

    if (origins.includes(origin)) {
      callback(null, true);
      return;
    }

    // Refused by omission: no Access-Control-Allow-Origin header, so the browser blocks it.
    // Not an error, because throwing here would answer 500 to what is a correct refusal.
    callback(null, false);
  },

  methods: ["GET", "POST", "OPTIONS"],

  // Authorization for the bearer token, Idempotency-Key for transfers, Content-Type for the
  // JSON body.
  allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],

  // Everything the client needs to read off a response: the request id for an error report,
  // Retry-After on a 429 or 503, and the rate limit counters.
  exposedHeaders: [
    "X-Request-Id",
    "Retry-After",
    "RateLimit-Limit",
    "RateLimit-Remaining",
    "RateLimit-Reset",
    "RateLimit-Policy",
  ],

  credentials: false,

  // Cache the preflight for a day, so a browser is not asking on every transfer.
  maxAge: 86_400,
};

export const corsMiddleware = cors(options);
export const configuredOrigins = origins;
