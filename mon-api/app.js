import "dotenv/config";
import express from "express";
import router from "./route.js";
import { authErrorHandler, installSecurity } from "./fourni/auth/index.ts";
import { requestLogger } from "./middleware/request-logger.js";
import { logger } from "./logger.js";

const app = express();

app.use(requestLogger);
installSecurity(app, {
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
});

app.use("/", router);
app.use((_req, res) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Route inconnue",
    },
  });
});
app.use(authErrorHandler);
app.use((error, req, res, next) => {
  logger.error({ requestId: res.locals.requestId }, "Unhandled request error");
  if (res.headersSent) return next(error);
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Erreur interne.",
    },
  });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  logger.info({ port }, "API listening");
});