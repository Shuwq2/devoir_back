import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startTestApi, type TestApi } from "./test-api.ts";

let api: TestApi;

before(async () => {
  api = await startTestApi();
});

after(async () => {
  await api?.close();
});

describe("Plats", () => {
  it("renvoie les plats paginés, filtre la recherche et valide les paramètres", async () => {
    const response = await api.request("GET", "/dishes");
    const page = response.body as {
      items: Array<{
        id: number;
        name: string;
        description: string;
        priceCents: number;
        available: boolean;
        category: { id: number; name: string };
        allergens: Array<{ code: string; label: string }>;
      }>;
      total: number;
      page: number;
      pageSize: number;
    };

    assert.equal(response.status, 200, "La carte doit répondre 200.");
    assert.equal(page.page, 1, "La page par défaut est 1.");
    assert.equal(page.pageSize, 20, "La taille de page par défaut est 20.");
    assert.equal(page.total, 16, "Le seed contient 16 plats.");
    assert.ok(page.items.length <= page.pageSize, "La page ne dépasse pas sa taille demandée.");
    assert.ok(page.items.every((dish) =>
      Number.isInteger(dish.id)
      && dish.name.length > 0
      && typeof dish.description === "string"
      && Number.isInteger(dish.priceCents)
      && typeof dish.available === "boolean"
      && Number.isInteger(dish.category.id)
      && Array.isArray(dish.allergens),
    ), "Chaque plat doit respecter le format attendu.");

    const search = await api.request("GET", "/dishes?q=FRITES");
    const matchingDishes = (search.body as { items: Array<{ name: string }> }).items;
    assert.ok(matchingDishes.some((dish) => dish.name === "Frites maison"));
    assert.ok(matchingDishes.some((dish) => dish.name === "Patates douces frites"));

    const invalidPage = await api.request("GET", "/dishes?pageSize=51");
    const missingDish = await api.request("GET", "/dishes/999999");
    assert.equal(invalidPage.status, 400, "Une taille de page supérieure à 50 est refusée.");
    assert.equal((invalidPage.body as { error: { code: string } }).error.code, "VALIDATION_ERROR");
    assert.equal(missingDish.status, 404, "Un plat inconnu renvoie 404.");
    assert.equal((missingDish.body as { error: { code: string } }).error.code, "NOT_FOUND");
  });
});