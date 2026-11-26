import { Router } from "express";
import { auth, controllers } from "../container.js";
import catalogRouter from "./catalog.routes.js";
import ordersRouter from "./orders.routes.js";

const router = Router();

router.get("/", (req, res) => {
  res.send("Mon API fonctionne !");
});

router.get("/health", controllers.health);
router.use("/", catalogRouter);
router.use("/orders", ordersRouter);
router.use("/auth", auth.router);

export default router;
