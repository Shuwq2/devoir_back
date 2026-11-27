import { z } from "zod";
import { AuthHttpError } from "../fourni/auth/index.ts";

const dishFields = {
  name: z.string().trim().min(2).max(80),
  description: z.string().max(300),
  priceCents: z.number().int().min(50).max(10000),
  categoryId: z.number().int().positive(),
  allergens: z.array(z.string()),
  available: z.boolean(),
  stock: z.number().int().nonnegative().nullable(),
};

const createDishSchema = z.strictObject({
  ...dishFields,
  description: dishFields.description.default(""),
  allergens: dishFields.allergens.default([]),
  available: dishFields.available.default(true),
  stock: dishFields.stock.default(null),
});

const updateDishSchema = z.strictObject(
  Object.fromEntries(
    Object.entries(dishFields).map(([key, schema]) => [key, schema.optional()]),
  ),
).refine((dish) => Object.keys(dish).length > 0, "Au moins un champ est requis.");

export function parseDishInput(body, { partial = false } = {}) {
  const result = (partial ? updateDishSchema : createDishSchema).safeParse(body);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join(".") || "body",
      message: issue.message,
    }));
    throw new AuthHttpError(400, "VALIDATION_ERROR", "Données invalides.", details);
  }
  return result.data;
}

export function parsePositiveId(rawId) {
  const id = Number(rawId);
  if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(id) || id < 1) {
    throw new AuthHttpError(
      400,
      "VALIDATION_ERROR",
      "Données invalides.",
      [{ path: "id", message: "Doit être un entier strictement positif." }],
    );
  }
  return id;
}
