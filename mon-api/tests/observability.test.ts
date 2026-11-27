import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startTestApi } from "./test-api.ts";

let api: Awaited<ReturnType<typeof startTestApi>>;

before(async () => {
  api = await startTestApi();
});

after(async () => {
  await api?.close();
});

describe("Observabilité et cache du catalogue", () => {
  it("vérifie la base et attribue un identifiant unique aux réponses réussies et en erreur", async () => {
    const health = await api.request("GET", "/health");
    const unknown = await api.request("GET", "/route-inconnue");

    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { status: "ok", database: "up" });
    const healthId = health.headers.get("x-request-id");
    const unknownId = unknown.headers.get("x-request-id");
    assert.ok(healthId);
    assert.ok(unknownId);
    assert.notEqual(healthId, unknownId);
  });

  it("invalide les résultats en cache après une modification, une commande et une annulation", async () => {
    const adminLogin = await api.request("POST", "/auth/login", {
      email: "admin@roulotte.test",
      password: "Admin123!",
    });
    const adminToken = (adminLogin.body as { token: string }).token;
    const customerLogin = await api.request("POST", "/auth/login", {
      email: "client@roulotte.test",
      password: "Client123!",
    });
    const customerToken = (customerLogin.body as { token: string }).token;
    const categories = await api.request("GET", "/categories");
    const categoryId = (categories.body as Array<{ id: number }>)[0].id;

    const created = await api.request("POST", "/dishes", {
      name: `Cache check ${Date.now()}`,
      priceCents: 500,
      categoryId,
      stock: 3,
    }, adminToken);
    assert.equal(created.status, 201);
    const dish = created.body as { id: number };
    const dishPath = `/dishes/${dish.id}`;
    assert.equal((await api.request("GET", dishPath)).status, 200);
    await api.request("GET", `/dishes?category=${categoryId}&pageSize=50`);

    const changed = await api.request("PATCH", dishPath, { priceCents: 650 }, adminToken);
    assert.equal(changed.status, 200);
    assert.equal((await api.request("GET", dishPath)).body.priceCents, 650);
    const listed = await api.request("GET", `/dishes?category=${categoryId}&pageSize=50`);
    assert.equal(
      (listed.body as { items: Array<{ id: number; priceCents: number }> }).items
        .find((item) => item.id === dish.id)?.priceCents,
      650,
    );

    const order = await api.request("POST", "/orders", {
      items: [{ dishId: dish.id, quantity: 2 }],
    }, customerToken);
    assert.equal(order.status, 201);
    assert.equal((await api.request("GET", dishPath)).body.stock, 1);
    const orderId = (order.body as { id: number }).id;
    const cancellation = await api.request(
      "PATCH",
      `/orders/${orderId}/status`,
      { status: "CANCELLED" },
      customerToken,
    );
    assert.equal(cancellation.status, 200);
    assert.equal((await api.request("GET", dishPath)).body.stock, 3);
  });
});
