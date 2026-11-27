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

  it("réserve la gestion des plats à l'admin et applique création, modification et suppression", async () => {
    const login = async (email: string, password: string) => {
      const response = await api.request("POST", "/auth/login", { email, password });
      assert.equal(response.status, 200);
      return (response.body as { token: string }).token;
    };
    const adminToken = await login("admin@roulotte.test", "Admin123!");
    const staffToken = await login("cuisine@roulotte.test", "Cuisine123!");
    const customerToken = await login("client@roulotte.test", "Client123!");
    const categories = await api.request("GET", "/categories");
    const categoryId = (categories.body as Array<{ id: number }>)[0].id;
    const name = `Plat de test ${Date.now()}`;
    const input = { name, priceCents: 500, categoryId, allergens: ["gluten"] };

    assert.equal((await api.request("POST", "/dishes", input)).status, 401);
    assert.equal((await api.request("POST", "/dishes", input, customerToken)).status, 403);
    assert.equal((await api.request("POST", "/dishes", input, staffToken)).status, 403);
    const invalidReference = await api.request(
      "POST",
      "/dishes",
      { ...input, categoryId: 999999 },
      adminToken,
    );
    assert.equal(invalidReference.status, 422);
    assert.equal(
      (invalidReference.body as { error: { code: string } }).error.code,
      "INVALID_REFERENCE",
    );

    const created = await api.request("POST", "/dishes", input, adminToken);
    assert.equal(created.status, 201);
    assert.equal(created.headers.get("location"), `/dishes/${(created.body as { id: number }).id}`);
    const dish = created.body as { id: number; description: string; available: boolean; stock: number | null };
    assert.equal(dish.description, "");
    assert.equal(dish.available, true);
    assert.equal(dish.stock, null);

    assert.equal(
      (await api.request("PATCH", `/dishes/${dish.id}`, { priceCents: 700 }, staffToken)).status,
      403,
    );
    const updated = await api.request("PATCH", `/dishes/${dish.id}`, { priceCents: 650 }, adminToken);
    assert.equal(updated.status, 200);
    assert.equal((updated.body as { priceCents: number }).priceCents, 650);
    assert.equal((await api.request("PATCH", `/dishes/${dish.id}`, {}, adminToken)).status, 400);

    const usedDish = await api.request(
      "POST",
      "/dishes",
      { name: `${name} commandé`, priceCents: 500, categoryId },
      adminToken,
    );
    const usedDishId = (usedDish.body as { id: number }).id;
    const order = await api.request(
      "POST",
      "/orders",
      { items: [{ dishId: usedDishId, quantity: 1 }] },
      customerToken,
    );
    assert.equal(order.status, 201);
    assert.equal((await api.request("DELETE", `/dishes/${usedDishId}`, undefined, adminToken)).status, 409);

    assert.equal((await api.request("DELETE", `/dishes/${dish.id}`, undefined, customerToken)).status, 403);
    assert.equal((await api.request("DELETE", `/dishes/${dish.id}`, undefined, adminToken)).status, 204);
    assert.equal((await api.request("GET", `/dishes/${dish.id}`)).status, 404);
  });
});