import "dotenv/config";
import { Router } from "express";
import { PrismaClient } from "./generated/prisma/client.ts";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

const router = Router();

router.get("/", (req, res) => {
  res.send("Mon API fonctionne !");
});

router.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "up" });
  } catch (error) {
    console.error(error);
    res.status(503).json({ status: "degraded", database: "down" });
  }
});

export default router;