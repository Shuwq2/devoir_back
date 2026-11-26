export const toOrderDto = (order) => ({
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
