import { parsePositiveId, parseDishInput } from "../validators/dish.validator.js";
import { logger } from "../logger.js";

export function createCatalogController(repository, dishesService) {
  return {
    async categories(req, res) {
      try {
        const categories = await repository.findCategories();
        res.json(categories);
      } catch {
        logger.error({ requestId: res.locals.requestId }, "Failed to fetch categories");
        res.status(500).json({ error: "Erreur lors de la récupération des catégories" });
      }
    },

    async allergens(req, res) {
      try {
        const allergens = await repository.findAllergens();
        res.json(allergens);
      } catch {
        logger.error({ requestId: res.locals.requestId }, "Failed to fetch allergens");
        res.status(500).json({ error: "Erreur lors de la récupération des allergènes" });
      }
    },

    async listDishes(req, res) {
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
        const [total, items] = await repository.findDishesPage({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
        });

        res.json({ items, total, page, pageSize });
      } catch {
        logger.error({ requestId: res.locals.requestId }, "Failed to fetch dishes");
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: "Erreur lors de la récupération des plats.",
          },
        });
      }
    },

    async getDishById(req, res) {
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
        const dish = await repository.findDishById(id);

        if (!dish) {
          return res.status(404).json({
            error: {
              code: "NOT_FOUND",
              message: "Plat non trouvé",
            },
          });
        }

        res.json(dish);
      } catch {
        logger.error({ requestId: res.locals.requestId }, "Failed to fetch dish");
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: "Erreur lors de la récupération du plat.",
          },
        });
      }
    },

    async createDish(req, res) {
      const input = parseDishInput(req.body);
      const dish = await dishesService.createDish(input);
      res.status(201).location(`/dishes/${dish.id}`).json(dish);
    },

    async updateDish(req, res) {
      const id = parsePositiveId(req.params.id);
      const input = parseDishInput(req.body, { partial: true });
      res.json(await dishesService.updateDish(id, input));
    },

    async deleteDish(req, res) {
      const id = parsePositiveId(req.params.id);
      await dishesService.deleteDish(id);
      res.status(204).end();
    },
  };
}
