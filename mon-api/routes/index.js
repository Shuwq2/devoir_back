import { Router } from "express";
import express from "express";
import { auth, controllers } from "../container.js";
import catalogRouter from "./catalog.routes.js";
import ordersRouter from "./orders.routes.js";
import { uploadsRoot } from "../services/dish-image.service.js";

const router = Router();

router.get("/", (req, res) => {
  res.send("Mon API fonctionne !");
});

router.get("/health", controllers.health);
router.get("/events", auth.requireAuth, controllers.events);
router.use("/uploads", express.static(uploadsRoot, {
  dotfiles: "deny",
  index: false,
  immutable: true,
  maxAge: "1y",
  setHeaders(res) {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  },
}));
router.use("/", catalogRouter);
router.use("/orders", ordersRouter);
router.use("/auth", auth.router);

export default router;
