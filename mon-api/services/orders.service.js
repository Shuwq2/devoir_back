import { AuthHttpError } from "../fourni/auth/index.ts";
import { priceOrderItems } from "./order.service.ts";
import { orderStatuses } from "../validators/order.validator.js";

export function createOrdersService(repository) {
  return {
    async createOrder(user, input) {
      return repository.transaction(async (transaction) => {
        const dishes = await repository.findDishes(
          transaction,
          input.items.map((item) => item.dishId),
        );
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

        return repository.createInTransaction(transaction, {
          customerId: user.id,
          note: input.note,
          totalCents,
          items: { create: items },
        });
      });
    },

    async listOrders(user, query) {
      const details = [];
      const parseQueryInt = (name, defaultValue, max = Infinity) => {
        const raw = query[name];
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

      const rawStatus = query.status;
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

      const sort = query.sort ?? "-createdAt";
      if (typeof sort !== "string" || !["createdAt", "-createdAt"].includes(sort)) {
        details.push({ path: "sort", message: "Doit valoir createdAt ou -createdAt." });
      }
      const page = parseQueryInt("page", 1);
      const pageSize = parseQueryInt("pageSize", 20, 50);

      if (details.length > 0) {
        throw new AuthHttpError(400, "VALIDATION_ERROR", "Paramètres de requête invalides.", details);
      }

      const where = {
        ...(user.role === "CUSTOMER" && { customerId: user.id }),
        ...(statuses.length > 0 && { status: { in: statuses } }),
      };
      const direction = sort === "createdAt" ? "asc" : "desc";
      const [total, orders] = await repository.findOrdersPage({
        where,
        orderBy: [{ createdAt: direction }, { id: direction }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      });

      return { orders, total, page, pageSize };
    },

    async getOrderById(user, rawId) {
      const id = Number(rawId);
      if (!Number.isSafeInteger(id) || id < 1) {
        throw new AuthHttpError(404, "NOT_FOUND", "Commande introuvable.");
      }

      const order = await repository.findOrderById(id);
      if (!order || (user.role === "CUSTOMER" && order.customerId !== user.id)) {
        throw new AuthHttpError(404, "NOT_FOUND", "Commande introuvable.");
      }
      return order;
    },
  };
}
