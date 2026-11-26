import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "../generated/prisma/client.ts";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { hashPassword } from "../fourni/auth/index.ts";

const menu = JSON.parse(
  readFileSync(new URL("../../donnees/menu.json", import.meta.url), "utf8"),
);

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

try {
  for (const category of menu.categories) {
    await prisma.category.upsert({
      where: { name: category.name },
      update: { position: category.position },
      create: category,
    });
  }

  for (const allergen of menu.allergens) {
    await prisma.allergen.upsert({
      where: { code: allergen.code },
      update: { label: allergen.label },
      create: allergen,
    });
  }

  for (const user of menu.users) {
    const password = await hashPassword(user.password);
    await prisma.users.upsert({
      where: { email: user.email },
      update: { name: user.name, password, role: user.role },
      create: { ...user, password },
    });
  }

  for (const dish of menu.dishes) {
    const allergenLinks = dish.allergens.map((code) => ({ code }));

    await prisma.dish.upsert({
      where: { name: dish.name },
      update: {
        description: dish.description,
        priceCents: dish.priceCents,
        available: dish.available,
        stock: dish.stock,
        category: { connect: { name: dish.category } },
        allergens: { set: allergenLinks },
      },
      create: {
        name: dish.name,
        description: dish.description,
        priceCents: dish.priceCents,
        available: dish.available,
        stock: dish.stock,
        category: { connect: { name: dish.category } },
        allergens: { connect: allergenLinks },
      },
    });
  }

  console.log("Menu chargé dans la base.");
} finally {
  await prisma.$disconnect();
}