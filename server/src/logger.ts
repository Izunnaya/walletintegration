import pino from "pino";
import { pinoHttp } from "pino-http";
import type { Options } from "pino-http";

// Structured logging, which the build spec asks for: every line is one JSON object carrying
// the request ID, so a failure a user reports by quoting their X-Request-Id can be found
// with one search instead of read out of a wall of text.
//
// This file exists because there has to be exactly one logger instance - pino-http attaches
// it to the request, the error handler and the transfer service write to the same one, and a
// second instance would mean two sets of settings and two chances to leak a header. It is
// configuration, not an abstraction: there is no wrapper here, and callers use pino's own
// methods directly.

// Pretty-printing is decided by whether anything is watching, not by NODE_ENV. In a terminal
// stdout is a TTY, so the output is coloured and readable. On Render it is a pipe, so the
// output is JSON that the log search can actually query. Tests are a pipe too, which keeps
// pino-pretty's worker thread out of the test process.
const pretty = process.stdout.isTTY === true;

export const loggerOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",

  // Without this, pino-http writes every request header into the log - which means every
  // Authorization header, which means a bearer token good for the rest of its lifetime
  // sitting in a log aggregator that far more people can read than can read the database.
  // Request bodies are never logged at all, which is what keeps passwords out.
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"],
    censor: "[redacted]",
  },

  // Renders the level as "info" rather than 30. Costs nothing and means a reader does not
  // need pino's numbering to read the output.
  formatters: {
    level: (label) => ({ level: label }),
  },

  // ISO timestamps instead of epoch milliseconds, because these are read by people.
  timestamp: pino.stdTimeFunctions.isoTime,
};

export const logger = pretty
  ? pino(loggerOptions, pino.transport({ target: "pino-pretty", options: { colorize: true } }))
  : pino(loggerOptions);

export const httpLoggerOptions: Options = {
  logger,

  // The ID already exists: attachRequestId generated it and put it in the X-Request-Id
  // response header before this middleware runs. Reusing it is the whole point - the
  // automatic request line and any error logged later carry the same id, so one search
  // finds both. Generating a second id here would silently break that.
  // The cast is because pino-http hands this the raw Node request, which knows nothing of
  // the property express middleware added to it.
  genReqId: (req) => (req as { requestId?: string }).requestId ?? "unknown",

  // A 4xx is the caller's mistake, not ours, so it must not page anybody; a 5xx is ours.
  customLogLevel: (_req, res, error) => {
    if (error) return "error";
    if (res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },

  customSuccessMessage: () => "request_completed",
  customErrorMessage: () => "request_errored",

  autoLogging: {
    // Render calls /health/ready every few seconds forever. Logging those would bury the
    // requests somebody actually cares about, and they are already visible as the health
    // check's own status in Render's dashboard.
    ignore: (req) => (req.url ?? "").startsWith("/health"),
  },

  // The defaults log the full header set on both sides. These keep the fields that identify
  // the request and drop the rest, so a line stays readable and cannot carry a credential.
  //
  // ip and forwardedFor are here for one specific reason: the rate limiter keys on req.ip,
  // and req.ip depends on getting the "trust proxy" hop count right for the platform. Set
  // too low, Express reports the proxy instead of the caller and every caller shares one
  // bucket. Nothing in a response reveals that - the limiter still returns plausible
  // counters - so these two fields next to each other are the only way to see it. When they
  // disagree about who the caller is, the hop count is wrong.
  //
  // A client IP is personal data, logged deliberately: a wallet service cannot investigate
  // abuse or defend a rate limit without it.
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      // req.raw, not req: pino-http hands the serializer its own wrapper, and ip is an
      // express getter that lives on the request underneath it.
      ip: (req.raw as { ip?: string } | undefined)?.ip,
      remoteAddress: req.remoteAddress,
      forwardedFor: req.headers?.["x-forwarded-for"],
    }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
};

export const httpLogger = pinoHttp(httpLoggerOptions);
