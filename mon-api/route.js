import "dotenv/config";
import { Router } from "express";
import { PrismaClient } from "./generated/prisma/client.ts";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { createAuth } from "./fourni/auth/index.ts";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

const toStoredUser = (user) =>
  user && ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    passwordHash: user.password,
  });

const users = {
  async findByEmail(email) {
    return toStoredUser(
      await prisma.users.findUnique({ where: { email } }),
    );
  },

  async findById(id) {
    return toStoredUser(
      await prisma.users.findUnique({ where: { id } }),
    );
  },

  async create({ email, name, passwordHash, role }) {
    return toStoredUser(
      await prisma.users.create({
        data: { email, name, password: passwordHash, role },
      }),
    );
  },
};

const auth = createAuth({
  users,
  jwtSecret: process.env.JWT_SECRET,
});

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

router.get("/categories", async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { position: "asc" },
    });
    res.json(categories);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur lors de la récupération des catégories" });
  }
});

router.get("/allergens", async (req, res) => {
  try {
    const allergens = await prisma.allergen.findMany({
      orderBy: { code: "asc" },
    });
    res.json(allergens);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur lors de la récupération des allergènes" });
  }
});


























































































































router.get("/dishes/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const dish = await prisma.dish.findUnique({
      where: { id: parseInt(id) },
      include: {
        category: true,
        allergens: true,
      },
    });

    if (!dish) {
      return res.status(404).json({ error: "Plat non trouvé" });
    }

    res.json(dish);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur lors de la récupération du plat" });
  }
});

router.use("/auth", auth.router);


export default router;