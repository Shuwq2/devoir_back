import { AuthHttpError } from "../fourni/auth/index.ts";

const dishInclude = {
  category: true,
  allergens: true,
};

function isPrismaError(error, code) {
  return error && typeof error === "object" && error.code === code;
}

export function createCatalogService(repository) {
  async function validateReferences(data) {
    if (data.categoryId !== undefined && !(await repository.findCategoryById(data.categoryId))) {
      throw new AuthHttpError(422, "INVALID_REFERENCE", "Catégorie inconnue.");
    }

    if (data.allergens !== undefined) {
      const allergens = await repository.findAllergensByCodes(data.allergens);
      if (allergens.length !== new Set(data.allergens).size) {
        throw new AuthHttpError(422, "INVALID_REFERENCE", "Un ou plusieurs allergènes sont inconnus.");
      }
    }
  }

  return {
    async createDish(input) {
      await validateReferences(input);
      try {
        return await repository.createDish(input, dishInclude);
      } catch (error) {
        if (isPrismaError(error, "P2002")) {
          throw new AuthHttpError(409, "CONFLICT", "Un plat porte déjà ce nom.");
        }
        if (isPrismaError(error, "P2003") || isPrismaError(error, "P2025")) {
          throw new AuthHttpError(422, "INVALID_REFERENCE", "Catégorie ou allergène inconnu.");
        }
        throw error;
      }
    },

    async updateDish(id, input) {
      const existing = await repository.findDishById(id);
      if (!existing) throw new AuthHttpError(404, "NOT_FOUND", "Plat introuvable.");

      await validateReferences(input);
      try {
        return await repository.updateDish(id, input, dishInclude);
      } catch (error) {
        if (isPrismaError(error, "P2002")) {
          throw new AuthHttpError(409, "CONFLICT", "Un plat porte déjà ce nom.");
        }
        if (isPrismaError(error, "P2025") && !(await repository.findDishById(id))) {
          throw new AuthHttpError(404, "NOT_FOUND", "Plat introuvable.");
        }
        if (isPrismaError(error, "P2003") || isPrismaError(error, "P2025")) {
          throw new AuthHttpError(422, "INVALID_REFERENCE", "Catégorie ou allergène inconnu.");
        }
        throw error;
      }
    },

    async deleteDish(id) {
      const existing = await repository.findDishById(id);
      if (!existing) throw new AuthHttpError(404, "NOT_FOUND", "Plat introuvable.");

      if (await repository.hasOrderItems(id)) {
        throw new AuthHttpError(409, "CONFLICT", "Un plat déjà commandé ne peut pas être supprimé.");
      }

      try {
        await repository.deleteDish(id);
      } catch (error) {
        if (isPrismaError(error, "P2003")) {
          throw new AuthHttpError(409, "CONFLICT", "Un plat déjà commandé ne peut pas être supprimé.");
        }
        if (isPrismaError(error, "P2025")) {
          throw new AuthHttpError(404, "NOT_FOUND", "Plat introuvable.");
        }
        throw error;
      }
    },
  };
}
