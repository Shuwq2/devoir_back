import "dotenv/config";
import { Router } from "express";
import { PrismaClient } from "./generated/prisma/client.ts";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { z } from "zod";
import { AuthHttpError, createAuth, currentUser } from "./fourni/auth/index.ts";
import { priceOrderItems } from "./services/order.service.ts";

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
const orderStatuses = ["RECEIVED", "PREPARING", "READY", "PICKED_UP", "CANCELLED"];

const orderInputSchema = z.strictObject({
  items: z.array(z.strictObject({
    dishId: z.number().int().positive(),
    quantity: z.number().int().min(1).max(10),
  })).min(1).max(20).superRefine((items, context) => {
    const seen = new Set();
    items.forEach((item, index) => {
      if (seen.has(item.dishId)) {
        context.addIssue({
          code: "custom",
          path: [index, "dishId"],
          message: "Un plat ne peut apparaître qu'une fois.",
        });
      }
      seen.add(item.dishId);
    });
  }),
  note: z.string().max(200).optional(),
});

const parseOrderInput = (body) => {
  const result = orderInputSchema.safeParse(body);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join(".") || "body",
      message: issue.message,
    }));
    throw new AuthHttpError(400, "VALIDATION_ERROR", "Données invalides.", details);
  }
  return result.data;
};

const orderInclude = {
  customer: { select: { id: true, name: true } },
  items: { orderBy: { id: "asc" } },
};

const toOrderDto = (order) => ({
  id: order.id,
  status: order.status,
  note: order.note,
  totalCents: order.totalCents,
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
  customer: { id: order.customer.id, name: order.customer.name },
  items: order.items.map((item) => ({
    dishId: item.dishId,
    name: item.name,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    lineTotalCents: item.lineTotalCents,
  })),
});

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

router.post("/orders", auth.requireAuth, async (req, res) => {
  const input = parseOrderInput(req.body);
  const user = currentUser(req);

  const order = await prisma.$transaction(async (transaction) => {
    const dishes = await transaction.dish.findMany({
      where: { id: { in: input.items.map((item) => item.dishId) } },
    });
    const dishesById = new Map(dishes.map((dish) => [dish.id, dish]));
    const unavailable = input.items.flatMap(({ dishId }) => {
      const dish = dishesById.get(dishId);
      if (!dish) return [{ dishId, reason: "NOT_FOUND" }];
      if (!dish.available) return [{ dishId, reason: "UNAVAILABLE" }];
      return [];
    });

    if (unavailable.length > 0) {
      throw new AuthHttpError(
        422,
        "DISH_UNAVAILABLE",
        "Un ou plusieurs plats sont indisponibles.",
        unavailable,
      );
    }

    const { items, totalCents } = priceOrderItems(input.items, dishesById);

    return transaction.order.create({
      data: {
        customerId: user.id,
        note: input.note,
        totalCents,
        items: { create: items },
      },
      include: orderInclude,
    });
  });

  res.status(201).location(`/orders/${order.id}`).json(toOrderDto(order));
});

router.get("/orders", auth.requireAuth, async (req, res) => {
  const details = [];
  const parseQueryInt = (name, defaultValue, max = Infinity) => {
    const raw = req.query[name];
    if (raw === undefined) return defaultValue;
    if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
      details.push({ path: name, message: "Doit être un entier positif." });
      return defaultValue;
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > max) {
      details.push({
        path: name,
        message: max === Infinity
          ? "Doit être supérieur ou égal à 1."
          : `Doit être compris entre 1 et ${max}.`,
      });
      return defaultValue;
    }
    return value;
  };

  const rawStatus = req.query.status;
  const statuses = rawStatus === undefined
    ? []
    : typeof rawStatus === "string"
      ? rawStatus.split(",").map((status) => status.trim()).filter(Boolean)
      : [];
  if (rawStatus !== undefined && typeof rawStatus !== "string") {
    details.push({ path: "status", message: "Doit être une valeur unique." });
  }
  if (statuses.some((status) => !orderStatuses.includes(status))) {
    details.push({ path: "status", message: "Contient un statut inconnu." });
  }

  const sort = req.query.sort ?? "-createdAt";
  if (typeof sort !== "string" || !["createdAt", "-createdAt"].includes(sort)) {
    details.push({ path: "sort", message: "Doit valoir createdAt ou -createdAt." });
  }
  const page = parseQueryInt("page", 1);
  const pageSize = parseQueryInt("pageSize", 20, 50);

  if (details.length > 0) {
    throw new AuthHttpError(400, "VALIDATION_ERROR", "Paramètres de requête invalides.", details);
  }

  const user = currentUser(req);
  const where = {
    ...(user.role === "CUSTOMER" && { customerId: user.id }),
    ...(statuses.length > 0 && { status: { in: statuses } }),
  };
  const direction = sort === "createdAt" ? "asc" : "desc";
  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy: [{ createdAt: direction }, { id: direction }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  res.json({ items: orders.map(toOrderDto), total, page, pageSize });
});

router.get("/orders/:id", auth.requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new AuthHttpError(404, "NOT_FOUND", "Commande introuvable.");
  }

  const user = currentUser(req);
  const order = await prisma.order.findUnique({
    where: { id },
    include: orderInclude,
  });
  if (!order || (user.role === "CUSTOMER" && order.customerId !== user.id)) {
    throw new AuthHttpError(404, "NOT_FOUND", "Commande introuvable.");
  }

  res.json(toOrderDto(order));
});

router.use("/auth", auth.router);


export default router;