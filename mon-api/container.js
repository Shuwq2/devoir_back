import { createAuth } from "./fourni/auth/index.ts";
import { prisma } from "./db/prisma.js";
import { createCatalogController } from "./controllers/catalog.controller.js";
import { createHealthController } from "./controllers/health.controller.js";
import { createOrdersController } from "./controllers/orders.controller.js";
import { createEventsController } from "./controllers/events.controller.js";
import { createCatalogRepository } from "./repositories/catalog.repository.js";
import { createCachedCatalogRepository } from "./repositories/cached-catalog.repository.js";
import { createHealthRepository } from "./repositories/health.repository.js";
import { createOrderRepository } from "./repositories/order.repository.js";
import { createUserRepository } from "./repositories/user.repository.js";
import { createOrdersService } from "./services/orders.service.js";
import { createCatalogService } from "./services/catalog.service.js";
import { createOrderEventHub } from "./services/order-event-hub.js";
import { createDishImageService } from "./services/dish-image.service.js";

const userRepository = createUserRepository(prisma);
const catalogRepository = createCachedCatalogRepository(createCatalogRepository(prisma));
const healthRepository = createHealthRepository(prisma);
const orderRepository = createOrderRepository(prisma);
const catalogService = createCatalogService(catalogRepository);
const dishImageService = createDishImageService(catalogRepository);
const orderEventHub = createOrderEventHub();

export const auth = createAuth({
  users: userRepository,
  jwtSecret: process.env.JWT_SECRET,
});

export const controllers = {
  catalog: createCatalogController(catalogRepository, catalogService, dishImageService),
  health: createHealthController(healthRepository),
  orders: createOrdersController(createOrdersService(orderRepository, orderEventHub, catalogRepository.invalidate)),
  events: createEventsController(orderEventHub),
};
