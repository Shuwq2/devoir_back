import { Router } from "express";
import { auth, controllers } from "../container.js";

const router = Router();

router.post("/", auth.requireAuth, controllers.orders.create);
router.get("/", auth.requireAuth, controllers.orders.list);
router.get("/:id", auth.requireAuth, controllers.orders.getById);
router.patch("/:id/status", auth.requireAuth, controllers.orders.updateStatus);

export default router;
