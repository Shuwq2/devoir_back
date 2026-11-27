import { currentUser } from "../fourni/auth/index.ts";
import { toOrderDto } from "../dto/order.dto.js";
import { parseOrderInput, parseOrderStatusInput } from "../validators/order.validator.js";
import { parsePositiveId } from "../validators/dish.validator.js";

export function createOrdersController(service) {
  return {
    async create(req, res) {
      const input = parseOrderInput(req.body);
      const user = currentUser(req);
      const order = await service.createOrder(user, input);

      res.status(201).location(`/orders/${order.id}`).json(toOrderDto(order));
    },

    async list(req, res) {
      const user = currentUser(req);
      const { orders, total, page, pageSize } = await service.listOrders(user, req.query);

      res.json({ items: orders.map(toOrderDto), total, page, pageSize });
    },

    async getById(req, res) {
      const user = currentUser(req);
      const order = await service.getOrderById(user, req.params.id);

      res.json(toOrderDto(order));
    },

    async updateStatus(req, res) {
      const id = parsePositiveId(req.params.id);
      const { status } = parseOrderStatusInput(req.body);
      const order = await service.updateOrderStatus(currentUser(req), id, status);

      res.json(toOrderDto(order));
    },
  };
}
