// Recette — Palier 3 : temps réel (SSE), photos des plats, cache sans données périmées, observabilité.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  API_URL, FRONT_ORIGIN, api, dishByName, expectError, expectStatus, loginAs, newCustomer, placeOrder, uniqueName,
} from "./lib.mjs";

// PNG 1×1 valide
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

function form(buffer, filename, type, field = "image") {
  const fd = new FormData();
  fd.append(field, new Blob([buffer], { type }), filename);
  return fd;
}

const putImage = (token, id, fd) => api("PUT", `/dishes/${id}/image`, { token, raw: fd });

async function newDish(fields = {}) {
  const admin = await loginAs("ADMIN");
  const categoryId = (await api("GET", "/categories")).body.find((c) => c.name === "Burgers").id;
  const res = await api("POST", "/dishes", { token: admin, body: { name: uniqueName("Plat P3"), priceCents: 900, categoryId, ...fields } });
  expectStatus(res, 201, "Création d'un plat de test (POST /dishes)");
  return res.body;
}

// Ouvre le flux SSE avec fetch (comme le front) et collecte les événements reçus
async function openStream(token) {
  const controller = new AbortController();
  const res = await fetch(`${API_URL}/events`, { headers: { authorization: `Bearer ${token}`, origin: FRONT_ORIGIN }, signal: controller.signal });
  const events = [];
  const stream = { res, events, close: () => controller.abort() };
  if (!res.ok || !res.body) return stream;
  (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          let type = "message";
          const data = [];
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) type = line.slice(6).trim();
            else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
          }
          if (data.length) {
            let parsed;
            try {
              parsed = JSON.parse(data.join("\n"));
            } catch {
              parsed = data.join("\n");
            }
            events.push({ type, data: parsed });
          }
        }
      }
    } catch {
      /* flux fermé */
    }
  })();
  return stream;
}

async function waitFor(stream, predicate, label, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = stream.events.find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`${label} : événement non reçu en ${timeoutMs / 1000} s (reçus : ${JSON.stringify(stream.events.map((e) => e.type))})`);
}

describe("Palier 3 · Observabilité", () => {
  it("GET /health vérifie la base : { status: \"ok\", database: \"up\" }", async () => {
    const res = await api("GET", "/health");
    expectStatus(res, 200, "GET /health");
    assert.deepEqual({ status: res.body.status, database: res.body.database }, { status: "ok", database: "up" });
  });

  it("chaque réponse porte un X-Request-Id différent", async () => {
    const a = await api("GET", "/categories");
    const b = await api("GET", "/route-inconnue");
    assert.ok(a.headers.get("x-request-id"), "En-tête X-Request-Id attendu (succès)");
    assert.ok(b.headers.get("x-request-id"), "En-tête X-Request-Id attendu (erreur)");
    assert.notEqual(a.headers.get("x-request-id"), b.headers.get("x-request-id"), "Un identifiant par requête");
  });
});

describe("Palier 3 · Temps réel (SSE)", () => {
  it("GET /events sans token → 401", async () => {
    expectError(await api("GET", "/events"), 401, "UNAUTHORIZED", "GET /events sans token");
  });

  it("GET /events ouvre un flux text/event-stream, autorisé pour le front (CORS)", async () => {
    const stream = await openStream(await loginAs("STAFF"));
    try {
      assert.equal(stream.res.status, 200, "Statut 200 attendu");
      assert.ok(stream.res.headers.get("content-type")?.startsWith("text/event-stream"), "Content-Type: text/event-stream attendu");
      assert.equal(stream.res.headers.get("access-control-allow-origin"), FRONT_ORIGIN, "Le front doit pouvoir lire le flux (CORS)");
    } finally {
      stream.close();
    }
  });

  it("la cuisine reçoit order.created ; le client reçoit order.updated de SA commande, pas des autres", async () => {
    const staffStream = await openStream(await loginAs("STAFF"));
    const alice = await newCustomer();
    const bob = await newCustomer();
    const aliceStream = await openStream(alice.token);
    const bobStream = await openStream(bob.token);
    try {
      const frites = await dishByName("Frites maison");
      const order = (await placeOrder(alice.token, [{ dishId: frites.id, quantity: 1 }])).body;
      const created = await waitFor(staffStream, (e) => e.type === "order.created" && e.data?.id === order.id, "Cuisine : order.created");
      assert.equal(created.data.status, "RECEIVED", "data = la commande au format Order");
      assert.ok(Array.isArray(created.data.items), "data = la commande au format Order (items)");

      expectStatus(await api("PATCH", `/orders/${order.id}/status`, { token: await loginAs("STAFF"), body: { status: "PREPARING" } }), 200, "Passage à PREPARING");
      const updated = await waitFor(aliceStream, (e) => e.type === "order.updated" && e.data?.id === order.id, "Alice : order.updated");
      assert.equal(updated.data.status, "PREPARING");
      await waitFor(staffStream, (e) => e.type === "order.updated" && e.data?.id === order.id, "Cuisine : order.updated");

      await new Promise((r) => setTimeout(r, 300));
      assert.ok(!bobStream.events.some((e) => e.data?.id === order.id), "Bob ne doit rien recevoir sur la commande d'Alice");
      assert.ok(!aliceStream.events.some((e) => e.type === "order.created"), "Un client ne reçoit pas order.created");
    } finally {
      staffStream.close();
      aliceStream.close();
      bobStream.close();
    }
  });
});

describe("Palier 3 · Photos des plats", () => {
  it("PUT /dishes/:id/image : 200, imageUrl, image servie et affichable depuis le front", async () => {
    const admin = await loginAs("ADMIN");
    const dish = await newDish();
    const res = await putImage(admin, dish.id, form(PNG, "burger.png", "image/png"));
    expectStatus(res, 200, "Envoi d'un PNG");
    assert.match(res.body.imageUrl ?? "", /^\/uploads\//, "imageUrl relative, commençant par /uploads/");
    assert.equal((await api("GET", `/dishes/${dish.id}`)).body.imageUrl, res.body.imageUrl, "GET /dishes/:id renvoie la nouvelle imageUrl");
    const img = await fetch(API_URL + res.body.imageUrl);
    assert.equal(img.status, 200, `GET ${res.body.imageUrl} : 200 attendu`);
    assert.equal(img.headers.get("content-type"), "image/png");
    const corp = img.headers.get("cross-origin-resource-policy");
    assert.ok(corp === null || corp === "cross-origin", `Cross-Origin-Resource-Policy: ${corp} → le front (autre origine) ne pourra pas afficher l'image`);
  });

  it("une nouvelle photo remplace l'ancienne (l'ancien fichier n'est plus servi)", async () => {
    const admin = await loginAs("ADMIN");
    const dish = await newDish();
    const first = (await putImage(admin, dish.id, form(PNG, "a.png", "image/png"))).body.imageUrl;
    const second = (await putImage(admin, dish.id, form(PNG, "b.png", "image/png"))).body.imageUrl;
    assert.notEqual(first, second, "Nouvelle URL attendue");
    assert.equal((await fetch(API_URL + first)).status, 404, "L'ancienne photo doit avoir été supprimée");
  });

  it("le contenu est vérifié : un faux PNG → 415 UNSUPPORTED_MEDIA_TYPE", async () => {
    const dish = await newDish();
    const res = await putImage(await loginAs("ADMIN"), dish.id, form(Buffer.from("je ne suis pas une image"), "piege.png", "image/png"));
    expectError(res, 415, "UNSUPPORTED_MEDIA_TYPE", "Fichier texte déguisé en PNG");
  });

  it("2 Mo maximum → 413 PAYLOAD_TOO_LARGE ; sans fichier → 400", async () => {
    const admin = await loginAs("ADMIN");
    const dish = await newDish();
    const big = Buffer.concat([PNG, Buffer.alloc(2.5 * 1024 * 1024)]);
    expectError(await putImage(admin, dish.id, form(big, "gros.png", "image/png")), 413, "PAYLOAD_TOO_LARGE", "Image de 2,5 Mo");
    expectError(await putImage(admin, dish.id, new FormData()), 400, "VALIDATION_ERROR", "Formulaire sans fichier");
  });

  it("réservé à l'admin (403), plat inexistant → 404", async () => {
    const dish = await newDish();
    expectError(await putImage(await loginAs("STAFF"), dish.id, form(PNG, "a.png", "image/png")), 403, "FORBIDDEN", "Cuisine");
    expectError(await putImage(await loginAs("ADMIN"), 999999, form(PNG, "a.png", "image/png")), 404, "NOT_FOUND", "Plat inexistant");
  });
});

describe("Palier 3 · Cache sans données périmées", () => {
  it("une modification est visible immédiatement dans la carte", async () => {
    const admin = await loginAs("ADMIN");
    const dish = await newDish({ priceCents: 900 });
    const query = `/dishes?category=${dish.category.id}&pageSize=50`;
    await api("GET", query);
    await api("GET", query); // si un cache existe, il est chaud
    await api("GET", `/dishes/${dish.id}`);
    expectStatus(await api("PATCH", `/dishes/${dish.id}`, { token: admin, body: { priceCents: 990 } }), 200, "Changement de prix");
    const listed = (await api("GET", query)).body.items.find((d) => d.id === dish.id);
    assert.equal(listed?.priceCents, 990, "GET /dishes doit montrer le nouveau prix");
    assert.equal((await api("GET", `/dishes/${dish.id}`)).body.priceCents, 990, "GET /dishes/:id doit montrer le nouveau prix");
  });

  it("le stock affiché suit les commandes et les annulations", async () => {
    const dish = await newDish({ stock: 5 });
    await api("GET", `/dishes/${dish.id}`); // cache chaud
    const { token } = await newCustomer();
    const order = (await placeOrder(token, [{ dishId: dish.id, quantity: 2 }])).body;
    assert.equal((await api("GET", `/dishes/${dish.id}`)).body.stock, 3, "Stock après commande");
    await api("PATCH", `/orders/${order.id}/status`, { token, body: { status: "CANCELLED" } });
    assert.equal((await api("GET", `/dishes/${dish.id}`)).body.stock, 5, "Stock après annulation");
  });
});
