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

describe("Carte", () => {
  it("renvoie les catégories et les allergènes de la carte", async () => {
    const response = await api.request("GET", "/categories");
    const allergenResponse = await api.request("GET", "/allergens");
    const categories = response.body as Array<{ id: number; name: string; position: number }>;
    const allergens = allergenResponse.body as Array<{ id: number; code: string; label: string }>;

    assert.equal(response.status, 200, "La carte doit répondre 200.");
    assert.deepEqual(
      categories.map(({ name, position }) => ({ name, position })),
      [
        { name: "Burgers", position: 1 },
        { name: "Veggie", position: 2 },
        { name: "Accompagnements", position: 3 },
        { name: "Desserts", position: 4 },
        { name: "Boissons", position: 5 },
      ],
    );
    assert.ok(categories.every((category) => Number.isInteger(category.id)), "Chaque catégorie doit avoir un id.");
    assert.equal(allergenResponse.status, 200, "Les allergènes doivent répondre 200.");
    assert.equal(allergens.length, 14, "Le menu doit contenir 14 allergènes.");
    assert.deepEqual(
      allergens.map(({ code }) => code),
      allergens.map(({ code }) => code).sort(),
      "Les allergènes doivent être triés par code.",
    );
  });
});