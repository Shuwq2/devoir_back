export function createCatalogRepository(prisma) {
  return {
    findCategories() {
      return prisma.category.findMany({
        orderBy: { position: "asc" },
      });
    },

    findAllergens() {
      return prisma.allergen.findMany({
        orderBy: { code: "asc" },
      });
    },

    findDishesPage({ where, skip, take }) {
      return Promise.all([
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
          skip,
          take,
        }),
      ]);
    },

    findDishById(id) {
      return prisma.dish.findUnique({
        where: { id },
        include: {
          category: true,
          allergens: true,
        },
      });
    },
  };
}
