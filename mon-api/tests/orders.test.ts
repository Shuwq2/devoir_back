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
});
