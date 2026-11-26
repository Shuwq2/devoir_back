export type RequestedOrderItem = {
  dishId: number;
  quantity: number;
};

type OrderDish = {
  name: string;
  priceCents: number;
};

export type PricedOrderItem = RequestedOrderItem & {
  name: string;
  unitPriceCents: number;
  lineTotalCents: number;
};

export function priceOrderItems(
  requestedItems: readonly RequestedOrderItem[],
  dishesById: ReadonlyMap<number, OrderDish>,
) {
  const items = requestedItems.map(({ dishId, quantity }): PricedOrderItem => {
    const dish = dishesById.get(dishId);
    if (!dish) {
      throw new Error(`Plat ${dishId} absent du chargement des plats.`);
    }

    return {
      dishId,
      name: dish.name,
      quantity,
      unitPriceCents: dish.priceCents,
      lineTotalCents: dish.priceCents * quantity,
    };
  });

  return {
    items,
    totalCents: items.reduce((total, item) => total + item.lineTotalCents, 0),
  };
}
