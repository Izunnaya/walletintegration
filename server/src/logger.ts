import pino from "pino";
import { pinoHttp } from "pino-http";
import type { Options } from "pino-http";

// Readable logs in a terminal; JSON when output is piped.
const pretty = process.stdout.isTTY === true;

export const loggerOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",

  // Keep passwords and bearer tokens out of logs.
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

  // Reuse the request ID assigned before parsing and routing.
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
    ignore: (req) => (req.url ?? "").startsWith("/health"),
  },

  // Log only request metadata. Proxy fields help verify IP attribution.
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
