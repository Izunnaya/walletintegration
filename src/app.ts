import { randomUUID } from "node:crypto";
import express from "express";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");

  app.use((_request, response, next) => {
    response.setHeader("X-Request-Id", randomUUID());
    next();
  });

  app.get("/health/live", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.use((_request, response) => {
    response.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Route not found.",
        requestId: response.getHeader("X-Request-Id"),
      },
    });
  });

  return app;
}
