import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startTestApi, type TestApi } from "./test-api.ts";

type TestDish = {
  id: number;
  name: string;
  description: string;
  priceCents: number;
  available: boolean;
  stock: number | null;
  category: { id: number; name: string };
  allergens: Array<{ code: string; label: string }>;
};

let api: TestApi;
let nextName = 0;
let nextCustomer = 0;
const tokens = new Map<string, string>();
const accounts = {
  ADMIN: { email: "admin@roulotte.test", password: "Admin123!" },
  STAFF: { email: "cuisine@roulotte.test", password: "Cuisine123!" },
  CUSTOMER: { email: "client@roulotte.test", password: "Client123!" },
};

before(async () => {
  api = await startTestApi();
});

after(async () => {
  await api?.close();
});

async function login(role: keyof typeof accounts) {
  const cached = tokens.get(role);
  if (cached) return cached;

  const response = await api.request("POST", "/auth/login", accounts[role]);
  assert.equal(response.status, 200);
  const token = (response.body as { token: string }).token;
  tokens.set(role, token);
  return token;
}

async function newCustomer() {
  const email = `palier2-${Date.now()}-${nextCustomer++}@example.test`;
  const registration = await api.request("POST", "/auth/register", {
    email,
    name: "Client palier 2",
    password: "motdepasse123",
  });
  assert.equal(registration.status, 201);

  const response = await api.request("POST", "/auth/login", {
    email,
    password: "motdepasse123",
  });
  assert.equal(response.status, 200);
  return (response.body as { token: string }).token;
}

async function categoryId() {
  const response = await api.request("GET", "/categories");
  assert.equal(response.status, 200);
  return (response.body as Array<{ id: number }>)[0].id;
}

async function newDish(fields: Record<string, unknown> = {}) {
  const response = await api.request(
    "POST",
    "/dishes",
    {
      name: `Test palier 2 ${Date.now()} ${nextName++}`,
      priceCents: 600,
      categoryId: await categoryId(),
      ...fields,
    },
    await login("ADMIN"),
  );
  assert.equal(response.status, 201);
  return response.body as TestDish;
}

async function placeOrder(token: string, items: Array<{ dishId: number; quantity: number }>) {
  return api.request("POST", "/orders", { items }, token);
}

async function setStatus(token: string, orderId: number, status: string) {
  return api.request("PATCH", `/orders/${orderId}/status`, { status }, token);
}

describe("Tests dédiés — palier 2", () => {
  it("réserve la création des plats à l'admin et renvoie valeurs par défaut et Location", async () => {
    const name = `Création ${Date.now()}`;
    const input = {
      name,
      priceCents: 500,
      categoryId: await categoryId(),
      allergens: ["gluten", "gluten"],
    };
    assert.equal((await api.request("POST", "/dishes", input)).status, 401);
    assert.equal((await api.request("POST", "/dishes", input, await login("CUSTOMER"))).status, 403);
    assert.equal((await api.request("POST", "/dishes", input, await login("STAFF"))).status, 403);

    const created = await api.request("POST", "/dishes", input, await login("ADMIN"));
    const dish = created.body as TestDish;
    assert.equal(created.status, 201);
    assert.equal(created.headers.get("location"), `/dishes/${dish.id}`);
    assert.equal(dish.description, "");
    assert.equal(dish.available, true);
    assert.equal(dish.stock, null);
    assert.deepEqual(dish.allergens.map(({ code }) => code), ["gluten"]);
  });

  it("valide strictement la création, les références et l'unicité du nom", async () => {
    const admin = await login("ADMIN");
    const dish = await newDish();
    const input = { name: dish.name, priceCents: 500, categoryId: dish.category.id };
    assert.equal((await api.request("POST", "/dishes", { ...input, unknown: true }, admin)).status, 400);
    assert.equal((await api.request("POST", "/dishes", { ...input, priceCents: 20 }, admin)).status, 400);
    assert.equal((await api.request("POST", "/dishes", { ...input, categoryId: 999999 }, admin)).status, 422);
    assert.equal((await api.request("POST", "/dishes", { ...input, name: `${dish.name} X`, allergens: ["inconnu"] }, admin)).status, 422);

    const duplicate = await api.request("POST", "/dishes", input, admin);
    assert.equal(duplicate.status, 409);
    assert.equal((duplicate.body as { error: { code: string } }).error.code, "CONFLICT");
  });

  it("modifie partiellement un plat, refuse les mises à jour invalides et conserve le prix historique", async () => {
    const dish = await newDish({ priceCents: 500, description: "Recette originale", stock: 7 });
    const customer = await newCustomer();
    const order = await placeOrder(customer, [{ dishId: dish.id, quantity: 2 }]);
    const orderId = (order.body as { id: number }).id;
    const admin = await login("ADMIN");

    const update = await api.request("PATCH", `/dishes/${dish.id}`, { priceCents: 900 }, admin);
    const updatedDish = update.body as TestDish;
    assert.equal(update.status, 200);
    assert.equal(updatedDish.priceCents, 900);
    assert.equal(updatedDish.description, "Recette originale");
    assert.equal(updatedDish.stock, 5);
    assert.equal((await api.request("PATCH", `/dishes/${dish.id}`, {}, admin)).status, 400);
    assert.equal((await api.request("PATCH", `/dishes/${dish.id}`, { extra: true }, admin)).status, 400);
    assert.equal((await api.request("PATCH", "/dishes/999999", { priceCents: 700 }, admin)).status, 404);

    const storedOrder = await api.request("GET", `/orders/${orderId}`, undefined, customer);
    const orderBody = storedOrder.body as {
      totalCents: number;
      items: Array<{ unitPriceCents: number; lineTotalCents: number }>;
    };
    assert.equal(orderBody.items[0].unitPriceCents, 500);
    assert.equal(orderBody.items[0].lineTotalCents, 1000);
    assert.equal(orderBody.totalCents, 1000);
  });

  it("supprime un plat inutilisé, mais refuse un plat déjà commandé", async () => {
    const admin = await login("ADMIN");
    const unused = await newDish();
    const used = await newDish();
    const order = await placeOrder(await newCustomer(), [{ dishId: used.id, quantity: 1 }]);
    assert.equal(order.status, 201);

    assert.equal((await api.request("DELETE", `/dishes/${unused.id}`)).status, 401);
    assert.equal((await api.request("DELETE", `/dishes/${unused.id}`, undefined, await login("STAFF"))).status, 403);
    assert.equal((await api.request("DELETE", `/dishes/${used.id}`, undefined, admin)).status, 409);
    assert.equal((await api.request("DELETE", `/dishes/${unused.id}`, undefined, admin)).status, 204);
    assert.equal((await api.request("GET", `/dishes/${unused.id}`)).status, 404);
  });

  it("fait avancer une commande de RECEIVED à PICKED_UP par les étapes cuisine", async () => {
    const dish = await newDish();
    const order = await placeOrder(await newCustomer(), [{ dishId: dish.id, quantity: 1 }]);
    const orderId = (order.body as { id: number }).id;
    const staff = await login("STAFF");

    for (const status of ["PREPARING", "READY", "PICKED_UP"]) {
      const response = await setStatus(staff, orderId, status);
      assert.equal(response.status, 200);
      assert.equal((response.body as { status: string }).status, status);
    }
  });

  it("refuse les transitions de statut interdites et les valeurs inconnues", async () => {
    const dish = await newDish();
    const order = await placeOrder(await newCustomer(), [{ dishId: dish.id, quantity: 1 }]);
    const orderId = (order.body as { id: number }).id;
    const staff = await login("STAFF");

    const skipped = await setStatus(staff, orderId, "READY");
    assert.equal(skipped.status, 409);
    assert.equal((skipped.body as { error: { code: string } }).error.code, "INVALID_TRANSITION");
    assert.equal((await setStatus(staff, orderId, "RECEIVED")).status, 409);
    assert.equal((await setStatus(staff, orderId, "UNKNOWN")).status, 400);
    await setStatus(staff, orderId, "PREPARING");
    await setStatus(staff, orderId, "READY");
    await setStatus(staff, orderId, "PICKED_UP");
    assert.equal((await setStatus(staff, orderId, "CANCELLED")).status, 409);
  });

  it("permet au client d'annuler uniquement sa commande reçue", async () => {
    const dish = await newDish();
    const owner = await newCustomer();
    const other = await newCustomer();
    const order = await placeOrder(owner, [{ dishId: dish.id, quantity: 1 }]);
    const orderId = (order.body as { id: number }).id;

    assert.equal((await setStatus(owner, orderId, "PREPARING")).status, 403);
    assert.equal((await setStatus(other, orderId, "CANCELLED")).status, 404);
    assert.equal((await setStatus(owner, orderId, "CANCELLED")).status, 200);

    const secondOrder = await placeOrder(owner, [{ dishId: dish.id, quantity: 1 }]);
    const secondId = (secondOrder.body as { id: number }).id;
    await setStatus(await login("STAFF"), secondId, "PREPARING");
    const lateCancellation = await setStatus(owner, secondId, "CANCELLED");
    assert.equal(lateCancellation.status, 409);
    assert.equal(
      (lateCancellation.body as { error: { code: string } }).error.code,
      "INVALID_TRANSITION",
    );
  });

  it("décrémente et restaure le stock, signale le manque et annule les débits partiels", async () => {
    const dish = await newDish({ stock: 2 });
    const customer = await newCustomer();
    const order = await placeOrder(customer, [{ dishId: dish.id, quantity: 1 }]);
    const orderId = (order.body as { id: number }).id;
    assert.equal(order.status, 201);
    assert.equal(((await api.request("GET", `/dishes/${dish.id}`)).body as TestDish).stock, 1);

    const rejected = await placeOrder(customer, [{ dishId: dish.id, quantity: 2 }]);
    assert.equal(rejected.status, 409);
    assert.equal((rejected.body as { error: { code: string } }).error.code, "OUT_OF_STOCK");
    assert.deepEqual(
      (rejected.body as { error: { details: Array<{ dishId: number; available: number }> } }).error.details,
      [{ dishId: dish.id, available: 1 }],
    );

    const plenty = await newDish({ stock: 5 });
    const scarce = await newDish({ stock: 1 });
    const allOrNothing = await placeOrder(customer, [
      { dishId: plenty.id, quantity: 2 },
      { dishId: scarce.id, quantity: 2 },
    ]);
    assert.equal(allOrNothing.status, 409);
    assert.equal(((await api.request("GET", `/dishes/${plenty.id}`)).body as TestDish).stock, 5);
    assert.equal(((await api.request("GET", `/dishes/${scarce.id}`)).body as TestDish).stock, 1);

    assert.equal((await setStatus(customer, orderId, "CANCELLED")).status, 200);
    assert.equal(((await api.request("GET", `/dishes/${dish.id}`)).body as TestDish).stock, 2);
  });

  it("empêche les commandes simultanées de dépasser le stock", async () => {
    const dish = await newDish({ stock: 3 });
    const customers = await Promise.all(Array.from({ length: 6 }, () => newCustomer()));
    const orders = await Promise.all(
      customers.map((customer) => placeOrder(customer, [{ dishId: dish.id, quantity: 1 }])),
    );
    assert.deepEqual(
      orders.map(({ status }) => status).sort(),
      [201, 201, 201, 409, 409, 409],
    );
    assert.equal(((await api.request("GET", `/dishes/${dish.id}`)).body as TestDish).stock, 0);
  });
});
