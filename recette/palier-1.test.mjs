// Recette — Palier 1 : la carte, les comptes, les commandes.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FRONT_ORIGIN, allDishes, api, checkDishShape, checkOrderShape, dishByName, expectError, expectStatus,
  loginAs, menu, newCustomer, placeOrder, uniqueEmail, why,
} from "./lib.mjs";

describe("Palier 1 · Socle technique", () => {
  it("GET /health répond { status: \"ok\" }", async () => {
    const res = await api("GET", "/health");
    expectStatus(res, 200, "GET /health");
    assert.equal(res.body?.status, "ok", why(res, "status \"ok\" attendu"));
  });

  it("une route inconnue renvoie 404 au format d'erreur imposé", async () => {
    expectError(await api("GET", "/route-qui-n-existe-pas"), 404, "NOT_FOUND", "GET /route-qui-n-existe-pas");
  });

  it("un JSON mal formé renvoie 400 INVALID_JSON", async () => {
    const res = await api("POST", "/auth/login", { raw: '{"email": "oups"', headers: { "content-type": "application/json" } });
    expectError(res, 400, "INVALID_JSON", "POST /auth/login avec un corps JSON cassé");
  });

  it("CORS : l'origine du front est autorisée", async () => {
    const res = await api("GET", "/categories", { headers: { origin: FRONT_ORIGIN } });
    assert.equal(res.headers.get("access-control-allow-origin"), FRONT_ORIGIN, `En-tête Access-Control-Allow-Origin: ${FRONT_ORIGIN} attendu`);
  });

  it("CORS : une autre origine n'est pas autorisée", async () => {
    const res = await api("GET", "/categories", { headers: { origin: "http://site-pirate.example" } });
    const allowed = res.headers.get("access-control-allow-origin");
    assert.ok(allowed !== "*" && allowed !== "http://site-pirate.example", `Une origine inconnue ne doit pas être autorisée (reçu : ${allowed})`);
  });

  it("CORS : la requête préliminaire (OPTIONS) autorise l'en-tête Authorization", async () => {
    const res = await api("OPTIONS", "/orders", {
      headers: { origin: FRONT_ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" },
    });
    assert.ok(res.status === 204 || res.status === 200, why(res, "OPTIONS /orders : 204 attendu"));
    const allowed = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    assert.ok(allowed.includes("authorization"), `Access-Control-Allow-Headers doit contenir authorization (reçu : « ${allowed} »)`);
  });
});

// Ces protections viennent du module FOURNI (fourni/auth) : ces tests vérifient qu'il est bien branché.
describe("Palier 1 · Module d'authentification fourni, branché", () => {
  it("en-têtes de sécurité (Helmet) et pas de X-Powered-By", async () => {
    const res = await api("GET", "/health");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff", "En-tête X-Content-Type-Options: nosniff attendu : installSecurity(app, …) est-il appelé avant les routes ?");
    assert.equal(res.headers.get("x-powered-by"), null, "X-Powered-By révèle la technologie : installSecurity(app, …) est-il appelé ?");
  });

  it("corps JSON de plus de 100 ko → 413 PAYLOAD_TOO_LARGE", async () => {
    const res = await api("POST", "/auth/login", { body: { email: "x@x.fr", password: "x".repeat(150_000) } });
    expectError(res, 413, "PAYLOAD_TOO_LARGE", "POST /auth/login avec un corps de 150 ko");
  });

  it("5 échecs de connexion pour un même email → 429, sans bloquer les autres comptes", async () => {
    const email = uniqueEmail("force-brute");
    for (let i = 1; i <= 5; i++) {
      expectError(await api("POST", "/auth/login", { body: { email, password: `essai-${i}` } }), 401, "UNAUTHORIZED", `Échec n° ${i}`);
    }
    expectError(await api("POST", "/auth/login", { body: { email, password: "essai-6" } }), 429, "TOO_MANY_REQUESTS", "6e tentative en 15 minutes");
    const other = await api("POST", "/auth/login", { body: { email: "client@roulotte.test", password: "Client123!" } });
    expectStatus(other, 200, "Un autre compte depuis la même IP doit pouvoir se connecter");
  });

  it("les connexions réussies ne sont pas comptées", async () => {
    const { user } = await newCustomer();
    for (let i = 1; i <= 7; i++) {
      expectStatus(await api("POST", "/auth/login", { body: { email: user.email, password: "motdepasse123" } }), 200, `Connexion réussie n° ${i}`);
    }
  });
});

describe("Palier 1 · La carte", () => {
  it("GET /categories : les 5 catégories du menu, triées par position", async () => {
    const res = await api("GET", "/categories");
    expectStatus(res, 200, "GET /categories");
    assert.deepEqual(res.body.map((c) => c.name), menu.categories.map((c) => c.name), "Catégories de donnees/menu.json, dans l'ordre des positions");
    for (const c of res.body) assert.ok(Number.isInteger(c.id) && Number.isInteger(c.position), "Catégorie : { id, name, position }");
  });

  it("GET /allergens : les 14 allergènes, triés par code", async () => {
    const res = await api("GET", "/allergens");
    expectStatus(res, 200, "GET /allergens");
    assert.equal(res.body.length, 14, "14 allergènes attendus");
    const codes = res.body.map((a) => a.code);
    assert.deepEqual(codes, [...codes].sort(), "Tri par code attendu (arachides, celeri, crustaces…)");
    assert.ok(res.body.every((a) => Number.isInteger(a.id) && a.code && a.label), "Allergène : { id, code, label }");
  });

  it("GET /dishes : page par défaut au format { items, total, page, pageSize }", async () => {
    const res = await api("GET", "/dishes");
    expectStatus(res, 200, "GET /dishes");
    assert.equal(res.body.page, 1, "page = 1 par défaut");
    assert.equal(res.body.pageSize, 20, "pageSize = 20 par défaut");
    assert.ok(res.body.total >= menu.dishes.length, `total >= ${menu.dishes.length} (plats du seed)`);
    assert.ok(res.body.items.length <= 20, "Au plus pageSize éléments");
    res.body.items.forEach((d, i) => checkDishShape(d, `items[${i}]`));
  });

  it("GET /dishes : tri par position de catégorie puis par nom", async () => {
    const positions = new Map(menu.categories.map((c) => [c.name, c.position]));
    const items = await allDishes();
    for (let i = 1; i < items.length; i++) {
      const [a, b] = [items[i - 1], items[i]];
      const pa = positions.get(a.category.name) ?? 99;
      const pb = positions.get(b.category.name) ?? 99;
      assert.ok(pa < pb || (pa === pb && a.name.localeCompare(b.name, "fr", { sensitivity: "base" }) <= 0), `Tri incorrect entre « ${a.name} » et « ${b.name} »`);
    }
  });

  it("GET /dishes : pagination (pageSize, page)", async () => {
    const p1 = await api("GET", "/dishes?pageSize=5&page=1");
    const p2 = await api("GET", "/dishes?pageSize=5&page=2");
    expectStatus(p2, 200, "GET /dishes?pageSize=5&page=2");
    assert.equal(p2.body.items.length, 5, "5 plats en page 2");
    assert.equal(p2.body.page, 2);
    assert.equal(p2.body.pageSize, 5);
    const ids = new Set(p1.body.items.map((d) => d.id));
    assert.ok(p2.body.items.every((d) => !ids.has(d.id)), "La page 2 ne doit pas répéter la page 1");
  });

  it("GET /dishes : pageSize > 50 ou page = 0 sont refusés", async () => {
    expectError(await api("GET", "/dishes?pageSize=51"), 400, "VALIDATION_ERROR", "GET /dishes?pageSize=51");
    expectError(await api("GET", "/dishes?page=0"), 400, "VALIDATION_ERROR", "GET /dishes?page=0");
  });

  it("GET /dishes?allergenFree=gluten,lait : aucun plat avec ces allergènes", async () => {
    const items = await allDishes("allergenFree=gluten,lait");
    assert.ok(items.length > 0, "Des plats sans gluten ni lait existent dans le seed");
    for (const d of items) assert.ok(!d.allergens.some((a) => a.code === "gluten" || a.code === "lait"), `« ${d.name} » contient gluten ou lait`);
    assert.ok(items.some((d) => d.name === "Frites maison"), "« Frites maison » attendu");
    assert.ok(!items.some((d) => d.name === "Wrap falafel"), "« Wrap falafel » (gluten) ne doit pas apparaître");
  });

  it("GET /dishes?category=<id> : uniquement cette catégorie", async () => {
    const boissons = (await api("GET", "/categories")).body.find((c) => c.name === "Boissons");
    const items = await allDishes(`category=${boissons.id}`);
    assert.ok(items.length >= 3, "Au moins 3 boissons");
    assert.ok(items.every((d) => d.category.id === boissons.id), "Que des boissons");
  });

  it("GET /dishes?available=false : les plats indisponibles", async () => {
    const items = await allDishes("available=false");
    assert.ok(items.some((d) => d.name === "Le Burger du mois"), "« Le Burger du mois » (indisponible) attendu");
    assert.ok(items.every((d) => d.available === false), "Que des plats indisponibles");
  });

  it("GET /dishes?q=frites : recherche dans le nom, insensible à la casse", async () => {
    const names = (await allDishes("q=FRITES")).map((d) => d.name);
    assert.ok(names.includes("Frites maison") && names.includes("Patates douces frites"), `Reçu : ${names.join(", ")}`);
  });

  it("GET /dishes/:id : un plat, 404 s'il n'existe pas, 400 si l'id est invalide", async () => {
    const frites = await dishByName("Frites maison");
    const res = await api("GET", `/dishes/${frites.id}`);
    expectStatus(res, 200, `GET /dishes/${frites.id}`);
    checkDishShape(res.body);
    assert.equal(res.body.name, "Frites maison");
    expectError(await api("GET", "/dishes/999999"), 404, "NOT_FOUND", "GET /dishes/999999");
    expectError(await api("GET", "/dishes/abc"), 400, "VALIDATION_ERROR", "GET /dishes/abc");
  });
});

describe("Palier 1 · Comptes", () => {
  it("inscription : 201, Location, rôle CUSTOMER, email en minuscules, aucun mot de passe renvoyé", async () => {
    const email = uniqueEmail("Inscription");
    const res = await api("POST", "/auth/register", { body: { email, name: "Nouvelle Cliente", password: "motdepasse123" } });
    expectStatus(res, 201, "POST /auth/register");
    assert.ok(res.headers.get("location"), "En-tête Location attendu");
    assert.equal(res.body.email, email.toLowerCase(), "Email enregistré en minuscules");
    assert.equal(res.body.role, "CUSTOMER");
    assert.deepEqual(Object.keys(res.body).sort(), ["email", "id", "name", "role"], "User = { id, email, name, role } exactement");
  });

  it("inscription : email déjà utilisé → 409 CONFLICT", async () => {
    const body = { email: uniqueEmail(), name: "Doublon", password: "motdepasse123" };
    await api("POST", "/auth/register", { body });
    expectError(await api("POST", "/auth/register", { body }), 409, "CONFLICT", "Deuxième inscription avec le même email");
  });

  it("inscription : impossible de se donner un rôle (champ inconnu refusé)", async () => {
    const res = await api("POST", "/auth/register", { body: { email: uniqueEmail(), name: "Pirate", password: "motdepasse123", role: "ADMIN" } });
    expectError(res, 400, "VALIDATION_ERROR", "Inscription avec \"role\": \"ADMIN\"");
  });

  it("inscription : données invalides → 400 avec le détail des champs", async () => {
    const res = await api("POST", "/auth/register", { body: { email: "pas-un-email", name: "A", password: "court" } });
    expectError(res, 400, "VALIDATION_ERROR", "Inscription invalide");
    assert.ok(Array.isArray(res.body.error.details) && res.body.error.details.length >= 3, why(res, "details : un élément par champ invalide (3)"));
  });

  it("connexion : token JWT avec expiration + utilisateur", async () => {
    const u = menu.users.find((x) => x.role === "CUSTOMER");
    const res = await api("POST", "/auth/login", { body: { email: u.email, password: u.password } });
    expectStatus(res, 200, "POST /auth/login (compte du seed)");
    const parts = res.body.token?.split(".") ?? [];
    assert.equal(parts.length, 3, "token au format JWT attendu");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    assert.ok(payload.exp, "Le JWT doit expirer (claim exp)");
    assert.ok(!JSON.stringify(payload).includes(u.password), "Le mot de passe ne doit pas être dans le token");
    assert.deepEqual(Object.keys(res.body.user).sort(), ["email", "id", "name", "role"]);
  });

  it("connexion : les trois comptes du seed ont le bon rôle", async () => {
    for (const u of menu.users) {
      const res = await api("POST", "/auth/login", { body: { email: u.email, password: u.password } });
      expectStatus(res, 200, `Connexion de ${u.email}`);
      assert.equal(res.body.user.role, u.role, `${u.email} doit avoir le rôle ${u.role}`);
    }
  });

  it("connexion : mauvais mot de passe ou email inconnu → 401, même message", async () => {
    const u = menu.users[0];
    const bad = await api("POST", "/auth/login", { body: { email: u.email, password: "mauvais-mot-de-passe" } });
    const unknown = await api("POST", "/auth/login", { body: { email: uniqueEmail(), password: "mauvais-mot-de-passe" } });
    expectError(bad, 401, "UNAUTHORIZED", "Mauvais mot de passe");
    expectError(unknown, 401, "UNAUTHORIZED", "Email inconnu");
    assert.equal(bad.body.error.message, unknown.body.error.message, "Même message : on ne révèle pas si l'email existe");
  });

  it("GET /auth/me : 401 sans token ou avec un token falsifié, l'utilisateur sinon", async () => {
    expectError(await api("GET", "/auth/me"), 401, "UNAUTHORIZED", "GET /auth/me sans token");
    expectError(await api("GET", "/auth/me", { token: "abc.def.ghi" }), 401, "UNAUTHORIZED", "GET /auth/me avec un token falsifié");
    const res = await api("GET", "/auth/me", { token: await loginAs("STAFF") });
    expectStatus(res, 200, "GET /auth/me");
    assert.equal(res.body.role, "STAFF");
    assert.ok(!("passwordHash" in res.body) && !("password" in res.body), "Aucun mot de passe ni hash");
  });
});

describe("Palier 1 · Commandes", () => {
  it("POST /orders sans token → 401", async () => {
    expectError(await placeOrder(undefined, [{ dishId: 1, quantity: 1 }]), 401, "UNAUTHORIZED", "POST /orders sans token");
  });

  it("POST /orders : 201, Location, statut RECEIVED, prix et totaux calculés par le serveur", async () => {
    const { token, user } = await newCustomer();
    const classique = await dishByName("Le Classique");
    const frites = await dishByName("Frites maison");
    const res = await placeOrder(token, [{ dishId: classique.id, quantity: 2 }, { dishId: frites.id, quantity: 1 }], "Sans oignons");
    expectStatus(res, 201, "POST /orders");
    assert.equal(res.headers.get("location"), `/orders/${res.body.id}`, "Location: /orders/<id> attendu");
    checkOrderShape(res.body);
    assert.equal(res.body.status, "RECEIVED");
    assert.equal(res.body.note, "Sans oignons");
    assert.equal(res.body.customer.id, user.id);
    assert.equal(res.body.totalCents, 2 * classique.priceCents + frites.priceCents, "totalCents = somme des lignes");
    const line = res.body.items.find((i) => i.dishId === classique.id);
    assert.deepEqual(
      { name: line.name, quantity: line.quantity, unitPriceCents: line.unitPriceCents, lineTotalCents: line.lineTotalCents },
      { name: "Le Classique", quantity: 2, unitPriceCents: classique.priceCents, lineTotalCents: 2 * classique.priceCents },
    );
  });

  it("POST /orders : un prix envoyé par le client est refusé (champ inconnu)", async () => {
    const { token } = await newCustomer();
    const frites = await dishByName("Frites maison");
    const res = await placeOrder(token, [{ dishId: frites.id, quantity: 1, unitPriceCents: 1 }]);
    expectError(res, 400, "VALIDATION_ERROR", "Ligne de commande avec un prix fourni par le client");
  });

  it("POST /orders : validation (liste vide, quantité > 10, plat en double)", async () => {
    const { token } = await newCustomer();
    const frites = await dishByName("Frites maison");
    expectError(await placeOrder(token, []), 400, "VALIDATION_ERROR", "items vide");
    expectError(await placeOrder(token, [{ dishId: frites.id, quantity: 11 }]), 400, "VALIDATION_ERROR", "quantity = 11");
    expectError(await placeOrder(token, [{ dishId: frites.id, quantity: 1 }, { dishId: frites.id, quantity: 2 }]), 400, "VALIDATION_ERROR", "Deux lignes pour le même plat");
  });

  it("POST /orders : plat indisponible ou inexistant → 422 DISH_UNAVAILABLE avec le détail", async () => {
    const { token } = await newCustomer();
    const burgerDuMois = await dishByName("Le Burger du mois");
    const frites = await dishByName("Frites maison");
    const res = await placeOrder(token, [{ dishId: frites.id, quantity: 1 }, { dishId: burgerDuMois.id, quantity: 1 }, { dishId: 999999, quantity: 1 }]);
    expectError(res, 422, "DISH_UNAVAILABLE", "Commande avec un plat indisponible et un plat inexistant");
    const details = res.body.error.details ?? [];
    assert.ok(details.some((d) => d.dishId === burgerDuMois.id && d.reason === "UNAVAILABLE"), why(res, "details : { dishId, reason: \"UNAVAILABLE\" } attendu"));
    assert.ok(details.some((d) => d.dishId === 999999 && d.reason === "NOT_FOUND"), why(res, "details : { dishId: 999999, reason: \"NOT_FOUND\" } attendu"));
  });

  it("GET /orders : un client ne voit que SES commandes, les plus récentes d'abord", async () => {
    const alice = await newCustomer();
    const bob = await newCustomer();
    const frites = await dishByName("Frites maison");
    const a1 = (await placeOrder(alice.token, [{ dishId: frites.id, quantity: 1 }])).body;
    const a2 = (await placeOrder(alice.token, [{ dishId: frites.id, quantity: 2 }])).body;
    const b1 = (await placeOrder(bob.token, [{ dishId: frites.id, quantity: 3 }])).body;
    const res = await api("GET", "/orders", { token: alice.token });
    expectStatus(res, 200, "GET /orders (client)");
    assert.equal(res.body.total, 2, why(res, "Alice a passé 2 commandes"));
    assert.deepEqual(res.body.items.map((o) => o.id), [a2.id, a1.id], "Plus récentes d'abord par défaut");
    assert.ok(!res.body.items.some((o) => o.id === b1.id), "La commande de Bob ne doit pas apparaître");
    const asc = await api("GET", "/orders?sort=createdAt", { token: alice.token });
    assert.deepEqual(asc.body.items.map((o) => o.id), [a1.id, a2.id], "?sort=createdAt : plus anciennes d'abord");
  });

  it("GET /orders?status=… filtre par statut", async () => {
    const { token } = await newCustomer();
    const frites = await dishByName("Frites maison");
    await placeOrder(token, [{ dishId: frites.id, quantity: 1 }]);
    const received = await api("GET", "/orders?status=RECEIVED", { token });
    assert.equal(received.body.total, 1, why(received, "1 commande RECEIVED"));
    const other = await api("GET", "/orders?status=READY,PICKED_UP", { token });
    assert.equal(other.body.total, 0, why(other, "Aucune commande READY ou PICKED_UP"));
    expectError(await api("GET", "/orders?status=PERDUE", { token }), 400, "VALIDATION_ERROR", "Statut inconnu");
  });

  it("GET /orders/:id : visible par son client et par la cuisine, 404 pour un autre client", async () => {
    const alice = await newCustomer();
    const bob = await newCustomer();
    const frites = await dishByName("Frites maison");
    const order = (await placeOrder(alice.token, [{ dishId: frites.id, quantity: 1 }])).body;
    const own = await api("GET", `/orders/${order.id}`, { token: alice.token });
    expectStatus(own, 200, "Alice lit sa commande");
    checkOrderShape(own.body);
    expectError(await api("GET", `/orders/${order.id}`, { token: bob.token }), 404, "NOT_FOUND", "Bob lit la commande d'Alice");
    expectStatus(await api("GET", `/orders/${order.id}`, { token: await loginAs("STAFF") }), 200, "La cuisine lit la commande d'Alice");
    expectError(await api("GET", "/orders/999999", { token: alice.token }), 404, "NOT_FOUND", "Commande inexistante");
  });
});
