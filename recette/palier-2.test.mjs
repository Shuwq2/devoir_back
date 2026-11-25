// Recette — Palier 2 : la cuisine, l'administration de la carte, le stock.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  api, checkDishShape, dishByName, expectError, expectStatus, loginAs, newCustomer, placeOrder, uniqueEmail, uniqueName, why,
} from "./lib.mjs";

async function categoryId(name = "Desserts") {
  return (await api("GET", "/categories")).body.find((c) => c.name === name).id;
}

// Crée un plat de test (nom unique) avec l'admin du seed
async function newDish(fields = {}) {
  const admin = await loginAs("ADMIN");
  const res = await api("POST", "/dishes", {
    token: admin,
    body: { name: uniqueName("Plat recette"), priceCents: 500, categoryId: await categoryId(), ...fields },
  });
  expectStatus(res, 201, "Création d'un plat de test par l'admin (POST /dishes)");
  return res.body;
}

const setStatus = (token, id, status) => api("PATCH", `/orders/${id}/status`, { token, body: { status } });

describe("Palier 2 · Administration de la carte", () => {
  it("POST /dishes : 401 sans token, 403 pour un client ou la cuisine", async () => {
    const body = { name: uniqueName("Interdit"), priceCents: 500, categoryId: await categoryId() };
    expectError(await api("POST", "/dishes", { body }), 401, "UNAUTHORIZED", "Sans token");
    expectError(await api("POST", "/dishes", { token: (await newCustomer()).token, body }), 403, "FORBIDDEN", "Client");
    expectError(await api("POST", "/dishes", { token: await loginAs("STAFF"), body }), 403, "FORBIDDEN", "Cuisine");
  });

  it("POST /dishes : 201, Location, valeurs par défaut, allergènes reliés", async () => {
    const admin = await loginAs("ADMIN");
    const name = uniqueName("Tarte citron");
    const res = await api("POST", "/dishes", { token: admin, body: { name, priceCents: 450, categoryId: await categoryId(), allergens: ["gluten", "oeufs"] } });
    expectStatus(res, 201, "POST /dishes");
    assert.equal(res.headers.get("location"), `/dishes/${res.body.id}`, "Location: /dishes/<id> attendu");
    checkDishShape(res.body);
    assert.deepEqual(
      { name: res.body.name, description: res.body.description, available: res.body.available, stock: res.body.stock, category: res.body.category.name },
      { name, description: "", available: true, stock: null, category: "Desserts" },
      "Valeurs par défaut : description \"\", available true, stock null",
    );
    assert.deepEqual(res.body.allergens.map((a) => a.code).sort(), ["gluten", "oeufs"]);
  });

  it("POST /dishes : nom déjà pris → 409, catégorie ou allergène inconnu → 422, champ inconnu ou prix invalide → 400", async () => {
    const admin = await loginAs("ADMIN");
    const cat = await categoryId();
    expectError(await api("POST", "/dishes", { token: admin, body: { name: "Brownie", priceCents: 500, categoryId: cat } }), 409, "CONFLICT", "Nom déjà pris");
    expectError(await api("POST", "/dishes", { token: admin, body: { name: uniqueName("X"), priceCents: 500, categoryId: 9999 } }), 422, "INVALID_REFERENCE", "categoryId inconnu");
    expectError(
      await api("POST", "/dishes", { token: admin, body: { name: uniqueName("X"), priceCents: 500, categoryId: cat, allergens: ["kryptonite"] } }),
      422, "INVALID_REFERENCE", "Allergène inconnu",
    );
    expectError(await api("POST", "/dishes", { token: admin, body: { name: uniqueName("X"), priceCents: 500, categoryId: cat, promo: true } }), 400, "VALIDATION_ERROR", "Champ inconnu");
    expectError(await api("POST", "/dishes", { token: admin, body: { name: uniqueName("X"), priceCents: 10, categoryId: cat } }), 400, "VALIDATION_ERROR", "priceCents = 10");
  });

  it("PATCH /dishes/:id : modification partielle et stricte", async () => {
    const admin = await loginAs("ADMIN");
    const dish = await newDish({ allergens: ["lait"] });
    const res = await api("PATCH", `/dishes/${dish.id}`, { token: admin, body: { priceCents: 650, allergens: ["gluten"] } });
    expectStatus(res, 200, "PATCH /dishes/:id");
    assert.equal(res.body.priceCents, 650);
    assert.equal(res.body.name, dish.name, "Les champs non envoyés ne changent pas");
    assert.deepEqual(res.body.allergens.map((a) => a.code), ["gluten"], "La liste d'allergènes est remplacée");
    expectError(await api("PATCH", `/dishes/${dish.id}`, { token: admin, body: {} }), 400, "VALIDATION_ERROR", "Corps vide");
    expectError(await api("PATCH", `/dishes/${dish.id}`, { token: admin, body: { id: 1 } }), 400, "VALIDATION_ERROR", "Champ inconnu (id)");
    expectError(await api("PATCH", "/dishes/999999", { token: admin, body: { priceCents: 600 } }), 404, "NOT_FOUND", "Plat inexistant");
    expectError(await api("PATCH", `/dishes/${dish.id}`, { token: await loginAs("STAFF"), body: { priceCents: 1 } }), 403, "FORBIDDEN", "Cuisine");
  });

  it("DELETE /dishes/:id : 204, puis 404 ; 409 si le plat a déjà été commandé", async () => {
    const admin = await loginAs("ADMIN");
    const unused = await newDish();
    expectStatus(await api("DELETE", `/dishes/${unused.id}`, { token: admin }), 204, "Suppression d'un plat jamais commandé");
    expectError(await api("GET", `/dishes/${unused.id}`), 404, "NOT_FOUND", "Le plat supprimé ne doit plus exister");
    const ordered = await newDish();
    expectStatus(await placeOrder((await newCustomer()).token, [{ dishId: ordered.id, quantity: 1 }]), 201, "Commande du plat");
    expectError(await api("DELETE", `/dishes/${ordered.id}`, { token: admin }), 409, "CONFLICT", "Suppression d'un plat déjà commandé");
  });

  it("une commande garde le prix du jour où elle a été passée", async () => {
    const admin = await loginAs("ADMIN");
    const dish = await newDish({ priceCents: 500 });
    const { token } = await newCustomer();
    const order = (await placeOrder(token, [{ dishId: dish.id, quantity: 2 }])).body;
    await api("PATCH", `/dishes/${dish.id}`, { token: admin, body: { priceCents: 900 } });
    const again = await api("GET", `/orders/${order.id}`, { token });
    assert.equal(again.body.items[0].unitPriceCents, 500, "unitPriceCents ne doit pas suivre le nouveau prix");
    assert.equal(again.body.totalCents, 1000);
  });
});

describe("Palier 2 · Stock", () => {
  it("le plat expose son stock (null = illimité)", async () => {
    assert.equal((await dishByName("Frites maison")).stock, null, "Frites maison : stock null");
    assert.equal(typeof (await dishByName("Brownie")).stock, "number", "Brownie : stock numérique (seed)");
  });

  it("commander décrémente le stock ; trop demander → 409 OUT_OF_STOCK avec la quantité disponible", async () => {
    const dish = await newDish({ stock: 3 });
    const { token } = await newCustomer();
    expectStatus(await placeOrder(token, [{ dishId: dish.id, quantity: 2 }]), 201, "Commande de 2 portions sur 3");
    assert.equal((await api("GET", `/dishes/${dish.id}`)).body.stock, 1, "Il doit rester 1 portion");
    const res = await placeOrder(token, [{ dishId: dish.id, quantity: 2 }]);
    expectError(res, 409, "OUT_OF_STOCK", "Commande de 2 portions alors qu'il en reste 1");
    assert.deepEqual(res.body.error.details, [{ dishId: dish.id, available: 1 }], why(res, "details : [{ dishId, available: 1 }]"));
  });

  it("tout ou rien : une commande refusée ne consomme aucun stock", async () => {
    const plenty = await newDish({ stock: 5 });
    const scarce = await newDish({ stock: 1 });
    const { token } = await newCustomer();
    expectError(await placeOrder(token, [{ dishId: plenty.id, quantity: 2 }, { dishId: scarce.id, quantity: 3 }]), 409, "OUT_OF_STOCK", "Commande impossible");
    assert.equal((await api("GET", `/dishes/${plenty.id}`)).body.stock, 5, "Le stock de l'autre plat ne doit pas avoir bougé (transaction)");
  });

  it("commandes simultanées : jamais plus de portions vendues que le stock", async () => {
    const dish = await newDish({ stock: 3 });
    const customers = await Promise.all([1, 2, 3, 4, 5, 6].map(() => newCustomer()));
    const results = await Promise.all(customers.map(({ token }) => placeOrder(token, [{ dishId: dish.id, quantity: 1 }])));
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 201, 201, 409, 409, 409], `3 commandes acceptées et 3 refusées attendues (reçu : ${statuses.join(", ")})`);
    assert.equal((await api("GET", `/dishes/${dish.id}`)).body.stock, 0, "Stock final : 0");
  });
});

describe("Palier 2 · Cycle de vie des commandes", () => {
  it("la cuisine voit les commandes de tous les clients", async () => {
    const frites = await dishByName("Frites maison");
    const order = (await placeOrder((await newCustomer()).token, [{ dishId: frites.id, quantity: 1 }])).body;
    const res = await api("GET", "/orders?status=RECEIVED&sort=-createdAt&pageSize=50", { token: await loginAs("STAFF") });
    expectStatus(res, 200, "GET /orders (cuisine)");
    assert.ok(res.body.items.some((o) => o.id === order.id), "La commande d'un client doit apparaître pour la cuisine");
  });

  it("la cuisine fait avancer une commande jusqu'au retrait", async () => {
    const staff = await loginAs("STAFF");
    const frites = await dishByName("Frites maison");
    const order = (await placeOrder((await newCustomer()).token, [{ dishId: frites.id, quantity: 1 }])).body;
    for (const status of ["PREPARING", "READY", "PICKED_UP"]) {
      const res = await setStatus(staff, order.id, status);
      expectStatus(res, 200, `Passage à ${status}`);
      assert.equal(res.body.status, status);
    }
  });

  it("transitions interdites → 409 INVALID_TRANSITION ; statut inconnu → 400", async () => {
    const staff = await loginAs("STAFF");
    const frites = await dishByName("Frites maison");
    const order = (await placeOrder((await newCustomer()).token, [{ dishId: frites.id, quantity: 1 }])).body;
    expectError(await setStatus(staff, order.id, "READY"), 409, "INVALID_TRANSITION", "RECEIVED → READY (on saute la préparation)");
    expectError(await setStatus(staff, order.id, "RECEIVED"), 409, "INVALID_TRANSITION", "RECEIVED → RECEIVED");
    expectError(await setStatus(staff, order.id, "EN_COURS"), 400, "VALIDATION_ERROR", "Statut inconnu");
    await setStatus(staff, order.id, "PREPARING");
    await setStatus(staff, order.id, "READY");
    await setStatus(staff, order.id, "PICKED_UP");
    expectError(await setStatus(staff, order.id, "CANCELLED"), 409, "INVALID_TRANSITION", "Annuler une commande déjà retirée");
    expectError(await setStatus(staff, 999999, "PREPARING"), 404, "NOT_FOUND", "Commande inexistante");
  });

  it("un client annule SA commande tant qu'elle est RECEIVED, et rien d'autre", async () => {
    const staff = await loginAs("STAFF");
    const alice = await newCustomer();
    const bob = await newCustomer();
    const frites = await dishByName("Frites maison");
    const o1 = (await placeOrder(alice.token, [{ dishId: frites.id, quantity: 1 }])).body;
    expectError(await setStatus(alice.token, o1.id, "PREPARING"), 403, "FORBIDDEN", "Un client fait avancer sa commande");
    expectError(await setStatus(bob.token, o1.id, "CANCELLED"), 404, "NOT_FOUND", "Bob annule la commande d'Alice");
    const cancelled = await setStatus(alice.token, o1.id, "CANCELLED");
    expectStatus(cancelled, 200, "Alice annule sa commande RECEIVED");
    assert.equal(cancelled.body.status, "CANCELLED");
    const o2 = (await placeOrder(alice.token, [{ dishId: frites.id, quantity: 1 }])).body;
    await setStatus(staff, o2.id, "PREPARING");
    expectError(await setStatus(alice.token, o2.id, "CANCELLED"), 409, "INVALID_TRANSITION", "Alice annule une commande en préparation");
  });

  it("une annulation remet les portions en stock", async () => {
    const dish = await newDish({ stock: 4 });
    const { token } = await newCustomer();
    const order = (await placeOrder(token, [{ dishId: dish.id, quantity: 3 }])).body;
    assert.equal((await api("GET", `/dishes/${dish.id}`)).body.stock, 1);
    expectStatus(await setStatus(await loginAs("STAFF"), order.id, "CANCELLED"), 200, "Annulation par la cuisine");
    assert.equal((await api("GET", `/dishes/${dish.id}`)).body.stock, 4, "Les 3 portions doivent revenir en stock");
  });
});
