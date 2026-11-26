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

router.get("/dishes", async (req, res) => {
  const details = [];

  const readString = (key) => {
    const value = req.query[key];

    if (value === undefined) return "";
    if (typeof value !== "string") {
      details.push({ path: key, message: "Doit être une valeur unique." });
      return "";
    }

    return value.trim();
  };

  const parseInteger = (key, raw, defaultValue, max = Infinity) => {
    if (!raw) return defaultValue;

    if (!/^\d+$/.test(raw)) {
      details.push({ path: key, message: "Doit être un entier positif." });
      return defaultValue;
    }

    const value = Number(raw);

    if (!Number.isSafeInteger(value) || value < 1 || value > max) {
      details.push({
        path: key,
        message: max === Infinity
          ? "Doit être supérieur ou égal à 1."
          : `Doit être compris entre 1 et ${max}.`,
      });
      return defaultValue;
    }

    return value;
  };

  const categoryRaw = readString("category");
  const availableRaw = readString("available");
  const allergenFreeRaw = readString("allergenFree");
  const q = readString("q");
  const pageRaw = readString("page");
  const pageSizeRaw = readString("pageSize");

  const categoryId = categoryRaw
    ? parseInteger("category", categoryRaw, undefined)
    : undefined;

  let available;
  if (availableRaw) {
    if (availableRaw !== "true" && availableRaw !== "false") {
      details.push({
        path: "available",
        message: 'Doit valoir "true" ou "false".',
      });
    } else {
      available = availableRaw === "true";
    }
  }

  if (q.length > 50) {
    details.push({ path: "q", message: "Ne doit pas dépasser 50 caractères." });
  }

  const page = parseInteger("page", pageRaw, 1);
  const pageSize = parseInteger("pageSize", pageSizeRaw, 20, 50);

  if (details.length > 0) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Paramètres de requête invalides.",
        details,
      },
    });
  }

  const allergenCodes = allergenFreeRaw
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);

  const where = {
    ...(categoryId !== undefined && { categoryId }),
    ...(available !== undefined && { available }),
    ...(q && { name: { contains: q } }),
    ...(allergenCodes.length > 0 && {
      allergens: { none: { code: { in: allergenCodes } } },
    }),
  };

  try {
    const [total, items] = await Promise.all([
      prisma.dish.count({ where }),
      prisma.dish.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          allergens: { select: { code: true, label: true } },
        },
        orderBy: [
          { category: { position: "asc" } },
          { name: "asc" },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    res.json({ items, total, page, pageSize });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Erreur lors de la récupération des plats.",
      },
    });
  }
});


router.get("/dishes/:id", async (req, res) => {
  const rawId = req.params.id;
  const id = Number(rawId);

  if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Données invalides",
        details: [{ path: "id", message: "Doit être un entier strictement positif." }],
      },
    });
  }

  try {
    const dish = await prisma.dish.findUnique({
      where: { id },
      include: {
        category: true,
        allergens: true,
      },
    });

    if (!dish) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "Plat non trouvé",
        },
      });
    }

    res.json(dish);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Erreur lors de la récupération du plat.",
      },
    });
  }
});

router.use("/auth", auth.router);


export default router;