const orderInclude = {
  customer: { select: { id: true, name: true } },
  items: { orderBy: { id: "asc" } },
};

export function createOrderRepository(prisma) {
  return {
    transaction(callback) {
      return prisma.$transaction(callback);
    },

    findDishes(transaction, ids) {
      return transaction.dish.findMany({
        where: { id: { in: ids } },
      });
    },

    createInTransaction(transaction, data) {
      return transaction.order.create({
        data,
        include: orderInclude,
      });
    },

    findOrdersPage({ where, orderBy, skip, take }) {
      return Promise.all([
        prisma.order.count({ where }),
        prisma.order.findMany({
          where,
          include: orderInclude,
          orderBy,
          skip,
          take,
        }),
      ]);
    },

    findOrderById(id) {
      return prisma.order.findUnique({
        where: { id },
        include: orderInclude,
      });
    },
  };
}
