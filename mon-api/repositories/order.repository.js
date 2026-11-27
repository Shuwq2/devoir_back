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

    decrementDishStock(transaction, id, quantity) {
      return transaction.dish.updateMany({
        where: { id, stock: { gte: quantity } },
        data: { stock: { decrement: quantity } },
      }).then((result) => result.count > 0);
    },

    findDishStock(transaction, id) {
      return transaction.dish.findUnique({
        where: { id },
        select: { stock: true },
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

    findOrderById(id, client = prisma) {
      return client.order.findUnique({
        where: { id },
        include: orderInclude,
      });
    },

    updateOrderStatus(transaction, id, currentStatus, status) {
      return transaction.order.updateMany({
        where: { id, status: currentStatus },
        data: { status },
      }).then((result) => result.count > 0);
    },

    incrementDishStock(transaction, id, quantity) {
      return transaction.dish.updateMany({
        where: { id, stock: { not: null } },
        data: { stock: { increment: quantity } },
      });
    },
  };
}
