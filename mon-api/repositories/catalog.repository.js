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

    findCategoryById(id) {
      return prisma.category.findUnique({ where: { id }, select: { id: true } });
    },

    findAllergensByCodes(codes) {
      return prisma.allergen.findMany({
        where: { code: { in: codes } },
        select: { code: true },
      });
    },

    createDish(input, include) {
      const { allergens, ...fields } = input;
      return prisma.dish.create({
        data: {
          ...fields,
          allergens: { connect: [...new Set(allergens)].map((code) => ({ code })) },
        },
        include,
      });
    },

    updateDish(id, input, include) {
      const { allergens, ...fields } = input;
      return prisma.dish.update({
        where: { id },
        data: {
          ...fields,
          ...(allergens !== undefined && {
            allergens: { set: [...new Set(allergens)].map((code) => ({ code })) },
          }),
        },
        include,
      });
    },

    updateDishImage(id, imageUrl) {
      return prisma.dish.update({
        where: { id },
        data: { imageUrl },
        include: {
          category: true,
          allergens: true,
        },
      });
    },

    hasOrderItems(dishId) {
      return prisma.orderItem.findFirst({
        where: { dishId },
        select: { id: true },
      }).then(Boolean);
    },

    deleteDish(id) {
      return prisma.dish.delete({ where: { id } });
    },
  };
}
