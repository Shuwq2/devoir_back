import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { priceOrderItems } from "../services/order.service.ts";
import { startTestApi } from "./test-api.ts";

let api: Awaited<ReturnType<typeof startTestApi>>;

before(async () => {
  api = await startTestApi();
});

after(async () => {
  await api?.close();
});

describe("Commandes", () => {
  it("réserve le détail d’une commande à son client et à la cuisine", async () => {
    const connexionClient = await api.request("POST", "/auth/login", {
      email: "client@roulotte.test",
      password: "Client123!",
    });
    const tokenClient = (connexionClient.body as { token: string }).token;
    const carte = await api.request("GET", "/dishes?pageSize=50");
    const plats = (carte.body as { items: Array<{ id: number; name: string }> }).items;
    const frites = plats.find((plat) => plat.name === "Frites maison");
    assert.ok(frites, "Les frites doivent être présentes dans le menu.");

    const creation = await api.request("POST", "/orders", {
      items: [{ dishId: frites.id, quantity: 1 }],
    }, tokenClient);
    const orderId = (creation.body as { id: number }).id;
    assert.equal(creation.status, 201, "La commande de test doit être créée.");

    const emailAutreClient = `autre-${Date.now()}@example.test`;
    const inscription = await api.request("POST", "/auth/register", {
      email: emailAutreClient,
      name: "Autre client",
      password: "motdepasse123",
    });
    assert.equal(inscription.status, 201, "Le second client doit être créé.");
    const connexionAutreClient = await api.request("POST", "/auth/login", {
      email: emailAutreClient,
      password: "motdepasse123",
    });
    const tokenAutreClient = (connexionAutreClient.body as { token: string }).token;
    const connexionCuisine = await api.request("POST", "/auth/login", {
      email: "cuisine@roulotte.test",
      password: "Cuisine123!",
    });
    const tokenCuisine = (connexionCuisine.body as { token: string }).token;

    const client = await api.request("GET", `/orders/${orderId}`, undefined, tokenClient);
    const autreClient = await api.request("GET", `/orders/${orderId}`, undefined, tokenAutreClient);
    const cuisine = await api.request("GET", `/orders/${orderId}`, undefined, tokenCuisine);

    assert.equal(client.status, 200, "Le client peut lire sa commande.");
    assert.equal(autreClient.status, 404, "La commande d’un autre client reste masquée.");
    assert.equal(cuisine.status, 200, "La cuisine peut lire toutes les commandes.");
  });

  it("crée une commande protégée avec les prix calculés par le serveur", async () => {
    const sansJeton = await api.request("POST", "/orders", {
      items: [{ dishId: 1, quantity: 1 }],
    });
    assert.equal(sansJeton.status, 401, "Une commande sans jeton doit être refusée.");

    const carte = await api.request("GET", "/dishes?pageSize=50");
    const plats = (carte.body as { items: Array<{ id: number; name: string; priceCents: number }> }).items;
    const frites = plats.find((plat) => plat.name === "Frites maison");
    assert.ok(frites, "Les frites doivent être présentes dans le menu de test.");

    const connexion = await api.request("POST", "/auth/login", {
      email: "client@roulotte.test",
      password: "Client123!",
    });
    assert.equal(connexion.status, 200, "Le compte client du seed doit pouvoir se connecter.");
    const token = (connexion.body as { token: string }).token;
    const commande = await api.request("POST", "/orders", {
      items: [{ dishId: frites.id, quantity: 2 }],
      note: "Sans sel",
    }, token);
    const order = commande.body as {
      id: number;
      status: string;
      note: string;
      totalCents: number;
      items: Array<{ unitPriceCents: number; lineTotalCents: number }>;
    };

    assert.equal(commande.status, 201, "La création doit répondre 201.");
    assert.equal(commande.headers.get("location"), `/orders/${order.id}`);
    assert.equal(order.status, "RECEIVED");
    assert.equal(order.note, "Sans sel");
    assert.equal(order.items[0].unitPriceCents, frites.priceCents);
    assert.equal(order.items[0].lineTotalCents, frites.priceCents * 2);
    assert.equal(order.totalCents, frites.priceCents * 2);

    const liste = await api.request("GET", "/orders", undefined, token);
    const commandes = (liste.body as { items: Array<{ id: number }> }).items;
    assert.ok(commandes.some((item) => item.id === order.id), "La commande doit apparaître dans la liste du client.");
  });

  it("teste unitairement le calcul des lignes et du total", () => {
    const resultat = priceOrderItems(
      [{ dishId: 3, quantity: 2 }, { dishId: 8, quantity: 1 }],
      new Map([
        [3, { name: "Burger", priceCents: 1150 }],
        [8, { name: "Frites", priceCents: 400 }],
      ]),
    );

    assert.equal(resultat.items[0].lineTotalCents, 2300);
    assert.equal(resultat.items[1].lineTotalCents, 400);
    assert.equal(resultat.totalCents, 2700);
  });

  it("autorise les transitions cuisine et l'annulation client avec restauration du stock", async () => {
    const login = async (email: string, password: string) => {
      const response = await api.request("POST", "/auth/login", { email, password });
      assert.equal(response.status, 200);
      return (response.body as { token: string }).token;
    };
    const customerToken = await login("client@roulotte.test", "Client123!");
    const staffToken = await login("cuisine@roulotte.test", "Cuisine123!");
    const adminToken = await login("admin@roulotte.test", "Admin123!");
    const registration = await api.request("POST", "/auth/register", {
      email: `autre-${Date.now()}@example.test`,
      name: "Autre client",
      password: "motdepasse123",
    });
    const otherCustomerToken = await login(
      (registration.body as { email: string }).email,
      "motdepasse123",
    );
    const categories = await api.request("GET", "/categories");
    const categoryId = (categories.body as Array<{ id: number }>)[0].id;
    const createdDish = await api.request("POST", "/dishes", {
      name: `Plat stock ${Date.now()}`,
      priceCents: 500,
      categoryId,
      stock: 4,
    }, adminToken);
    const dishId = (createdDish.body as { id: number }).id;
    const createdOrder = await api.request("POST", "/orders", {
      items: [{ dishId, quantity: 3 }],
    }, customerToken);
    const orderId = (createdOrder.body as { id: number }).id;

    const dishAfterOrder = await api.request("GET", `/dishes/${dishId}`);
    assert.equal((dishAfterOrder.body as { stock: number }).stock, 1);
    assert.equal((await api.request("PATCH", `/orders/${orderId}/status`, { status: "PREPARING" }, customerToken)).status, 403);
    assert.equal((await api.request("PATCH", `/orders/${orderId}/status`, { status: "CANCELLED" }, otherCustomerToken)).status, 404);

    const cancelled = await api.request(
      "PATCH",
      `/orders/${orderId}/status`,
      { status: "CANCELLED" },
      customerToken,
    );
    assert.equal(cancelled.status, 200);
    assert.equal((cancelled.body as { status: string }).status, "CANCELLED");
    const dishAfterCancel = await api.request("GET", `/dishes/${dishId}`);
    assert.equal((dishAfterCancel.body as { stock: number }).stock, 4);

    const kitchenOrder = await api.request("POST", "/orders", {
      items: [{ dishId, quantity: 1 }],
    }, customerToken);
    const kitchenOrderId = (kitchenOrder.body as { id: number }).id;
    const kitchenCancellation = await api.request(
      "PATCH",
      `/orders/${kitchenOrderId}/status`,
      { status: "CANCELLED" },
      staffToken,
    );
    assert.equal(kitchenCancellation.status, 200);
    const dishAfterKitchenCancel = await api.request("GET", `/dishes/${dishId}`);
    assert.equal((dishAfterKitchenCancel.body as { stock: number }).stock, 4);

    const nextOrder = await api.request("POST", "/orders", {
      items: [{ dishId, quantity: 1 }],
    }, customerToken);
    const nextOrderId = (nextOrder.body as { id: number }).id;
    for (const status of ["PREPARING", "READY", "PICKED_UP"]) {
      const update = await api.request("PATCH", `/orders/${nextOrderId}/status`, { status }, staffToken);
      assert.equal(update.status, 200);
      assert.equal((update.body as { status: string }).status, status);
    }

    const invalidTransition = await api.request(
      "PATCH",
      `/orders/${nextOrderId}/status`,
      { status: "CANCELLED" },
      staffToken,
    );
    assert.equal(invalidTransition.status, 409);
    assert.equal(
      (invalidTransition.body as { error: { code: string } }).error.code,
      "INVALID_TRANSITION",
    );
    assert.equal(
      (await api.request("PATCH", `/orders/${nextOrderId}/status`, { status: "UNKNOWN" }, staffToken)).status,
      400,
    );
  });

  it("réserve le stock atomiquement et refuse les commandes excédentaires", async () => {
    const adminResponse = await api.request("POST", "/auth/login", {
      email: "admin@roulotte.test",
      password: "Admin123!",
    });
    const adminToken = (adminResponse.body as { token: string }).token;
    const categoryResponse = await api.request("GET", "/categories");
    const categoryId = (categoryResponse.body as Array<{ id: number }>)[0].id;
    const dishResponse = await api.request("POST", "/dishes", {
      name: `Stock simultané ${Date.now()}`,
      priceCents: 500,
      categoryId,
      stock: 3,
    }, adminToken);
    const dishId = (dishResponse.body as { id: number }).id;

    const tokens = await Promise.all(
      Array.from({ length: 6 }, async (_, index) => {
        const email = `stock-${Date.now()}-${index}@example.test`;
        await api.request("POST", "/auth/register", {
          email,
          name: `Client ${index}`,
          password: "motdepasse123",
        });
        const login = await api.request("POST", "/auth/login", { email, password: "motdepasse123" });
        return (login.body as { token: string }).token;
      }),
    );
    const plentyResponse = await api.request("POST", "/dishes", {
      name: `Stock abondant ${Date.now()}`,
      priceCents: 500,
      categoryId,
      stock: 5,
    }, adminToken);
    const scarceResponse = await api.request("POST", "/dishes", {
      name: `Stock limité ${Date.now()}`,
      priceCents: 500,
      categoryId,
      stock: 1,
    }, adminToken);
    const plentyId = (plentyResponse.body as { id: number }).id;
    const scarceId = (scarceResponse.body as { id: number }).id;
    const stockTestToken = tokens[0];
    assert.ok(stockTestToken, "Le test doit avoir un client enregistré.");
    const rejectedOrder = await api.request("POST", "/orders", {
      items: [
        { dishId: plentyId, quantity: 2 },
        { dishId: scarceId, quantity: 2 },
      ],
    }, stockTestToken);
    assert.equal(rejectedOrder.status, 409);
    assert.equal(
      (rejectedOrder.body as { error: { code: string } }).error.code,
      "OUT_OF_STOCK",
    );
    const plentyAfterReject = await api.request("GET", `/dishes/${plentyId}`);
    const scarceAfterReject = await api.request("GET", `/dishes/${scarceId}`);
    assert.equal((plentyAfterReject.body as { stock: number }).stock, 5);
    assert.equal((scarceAfterReject.body as { stock: number }).stock, 1);

    const orders = await Promise.all(tokens.map((token) => api.request(
      "POST",
      "/orders",
      { items: [{ dishId, quantity: 1 }] },
      token,
    )));
    assert.deepEqual(
      orders.map(({ status }) => status).sort(),
      [201, 201, 201, 409, 409, 409],
    );
    const finalDish = await api.request("GET", `/dishes/${dishId}`);
    assert.equal((finalDish.body as { stock: number }).stock, 0);
  });
});
