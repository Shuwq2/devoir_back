import { Router } from "express";
import { controllers } from "../container.js";

const router = Router();

router.get("/categories", controllers.catalog.categories);
router.get("/allergens", controllers.catalog.allergens);
router.get("/dishes", controllers.catalog.listDishes);
router.get("/dishes/:id", controllers.catalog.getDishById);

export default router;
