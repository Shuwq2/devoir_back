export function createHealthController(repository) {
  return async (req, res) => {
    try {
      await repository.checkDatabase();
      res.json({ status: "ok", database: "up" });
    } catch (error) {
      console.error(error);
      res.status(503).json({ status: "degraded", database: "down" });
    }
  };
}
