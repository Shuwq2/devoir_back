import { z } from "zod";
import { AuthHttpError } from "../fourni/auth/index.ts";

export const orderStatuses = ["RECEIVED", "PREPARING", "READY", "PICKED_UP", "CANCELLED"];

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

export const parseOrderInput = (body) => {
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
