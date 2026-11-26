import { createAuth } from "./fourni/auth/index.ts";
import { prisma } from "./db/prisma.js";
import { createCatalogController } from "./controllers/catalog.controller.js";
import { createHealthController } from "./controllers/health.controller.js";
import { createOrdersController } from "./controllers/orders.controller.js";
import { createCatalogRepository } from "./repositories/catalog.repository.js";
import { createHealthRepository } from "./repositories/health.repository.js";
import { createOrderRepository } from "./repositories/order.repository.js";
import { createUserRepository } from "./repositories/user.repository.js";
import { createOrdersService } from "./services/orders.service.js";

const userRepository = createUserRepository(prisma);
const catalogRepository = createCatalogRepository(prisma);
const healthRepository = createHealthRepository(prisma);
const orderRepository = createOrderRepository(prisma);

export const auth = createAuth({
  users: userRepository,
  jwtSecret: process.env.JWT_SECRET,
});

export const controllers = {
  catalog: createCatalogController(catalogRepository),
  health: createHealthController(healthRepository),
  orders: createOrdersController(createOrdersService(orderRepository)),
};
