import "dotenv/config";
import express from "express";
import router from "./route.js";
import { authErrorHandler, installSecurity } from "./fourni/auth/index.ts";

const app = express();

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

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`API disponible sur http://localhost:${port}`);
});