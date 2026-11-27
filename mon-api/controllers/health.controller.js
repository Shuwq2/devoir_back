import { logger } from "../logger.js";

export function createHealthController(repository) {
  return async (req, res) => {
    try {
      await repository.checkDatabase();
      res.json({ status: "ok", database: "up" });
    } catch {
      logger.error({ requestId: res.locals.requestId }, "Database health check failed");
      res.status(503).json({ status: "degraded", database: "down" });
    }
  };
}
