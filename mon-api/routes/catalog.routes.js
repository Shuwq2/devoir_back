import { Router } from "express";
import { auth, controllers } from "../container.js";
import { dishImageUpload } from "../middleware/dish-image-upload.js";

const router = Router();

router.get("/categories", controllers.catalog.categories);
router.get("/allergens", controllers.catalog.allergens);
router.get("/dishes", controllers.catalog.listDishes);
router.post("/dishes", auth.requireAuth, auth.requireRole("ADMIN"), controllers.catalog.createDish);
router.get("/dishes/:id", controllers.catalog.getDishById);
router.patch("/dishes/:id", auth.requireAuth, auth.requireRole("ADMIN"), controllers.catalog.updateDish);
router.delete("/dishes/:id", auth.requireAuth, auth.requireRole("ADMIN"), controllers.catalog.deleteDish);
router.put(
  "/dishes/:id/image",
  auth.requireAuth,
  auth.requireRole("ADMIN"),
  dishImageUpload,
  controllers.catalog.uploadDishImage,
);

export default router;
