import multer from "multer";
import { AuthHttpError } from "../fourni/auth/index.ts";

const parseImageForm = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
}).single("image");

export function dishImageUpload(req, res, next) {
  parseImageForm(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return next(new AuthHttpError(413, "PAYLOAD_TOO_LARGE", "Image trop volumineuse (2 Mo maximum)."));
    }
    if (error instanceof multer.MulterError) {
      return next(new AuthHttpError(400, "VALIDATION_ERROR", "Formulaire d’image invalide."));
    }
    return next(error);
  });
}
