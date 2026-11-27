import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AuthHttpError } from "../fourni/auth/index.ts";

export const uploadsRoot = process.env.UPLOAD_DIR
  ? resolve(process.env.UPLOAD_DIR)
  : fileURLToPath(new URL("../uploads", import.meta.url));

const dishesDirectory = join(uploadsRoot, "dishes");

function imageType(buffer) {
  if (
    buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpg";
  }
  if (
    buffer.length >= 12
    && buffer.toString("ascii", 0, 4) === "RIFF"
    && buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

function previousImagePath(imageUrl) {
  const match = /^\/uploads\/dishes\/([0-9a-f-]{36})\.(png|jpg|webp)$/.exec(imageUrl ?? "");
  return match ? join(dishesDirectory, `${match[1]}.${match[2]}`) : null;
}

export function createDishImageService(repository) {
  return {
    async replaceImage(id, buffer) {
      const existing = await repository.findDishById(id);
      if (!existing) throw new AuthHttpError(404, "NOT_FOUND", "Plat introuvable.");

      const extension = imageType(buffer);
      if (!extension) {
        throw new AuthHttpError(415, "UNSUPPORTED_MEDIA_TYPE", "L’image doit être un PNG, JPEG ou WebP valide.");
      }

      await mkdir(dishesDirectory, { recursive: true });
      const filename = `${randomUUID()}.${extension}`;
      const path = join(dishesDirectory, filename);
      await writeFile(path, buffer, { flag: "wx" });

      let dish;
      try {
        dish = await repository.updateDishImage(id, `/uploads/dishes/${filename}`);
      } catch (error) {
        await rm(path, { force: true });
        throw error;
      }

      const oldPath = previousImagePath(existing.imageUrl);
      if (oldPath && oldPath !== path) await rm(oldPath, { force: true });
      return dish;
    },
  };
}
