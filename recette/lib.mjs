// Outils communs de la recette. Aucune dépendance : Node.js 22 suffit (fetch, node:test).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const API_URL = (process.env.API_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const FRONT_ORIGIN = process.env.FRONT_ORIGIN ?? "http://localhost:5173";
export const PAY_SIM_URL = (process.env.PAY_SIM_URL ?? "http://localhost:4010").replace(/\/$/, "");

export const menu = JSON.parse(readFileSync(new URL("../donnees/menu.json", import.meta.url), "utf8"));
export const seedUser = (role) => menu.users.find((u) => u.role === role);

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
export const uniqueEmail = (prefix = "recette") => `${prefix}-${unique()}@recette.test`;
export const uniqueName = (prefix) => `${prefix} ${unique()}`;

// Appel HTTP : renvoie { status, headers, body, text }
export async function api(method, path, { token, body, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  let payload = raw;
  if (body !== undefined) {
    h["content-type"] ??= "application/json";
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(API_URL + path, { method, headers: h, body: payload });
  } catch (err) {
    throw new Error(`API injoignable sur ${API_URL} (${err.cause?.code ?? err.message}). Est-elle démarrée ?`);
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, body: json, text };
}

// Message d'échec lisible : ce qu'on a envoyé, ce qu'on a reçu
export const why = (res, label) => `${label}\n  → reçu ${res.status} : ${res.text.slice(0, 400)}`;

export function expectStatus(res, status, label) {
  assert.equal(res.status, status, why(res, `${label} : statut ${status} attendu`));
}

// Format d'erreur imposé : { error: { code, message } }
export function expectError(res, status, code, label) {
  expectStatus(res, status, label);
  assert.ok(res.headers.get("content-type")?.includes("application/json"), why(res, `${label} : l'erreur doit être en JSON`));
  assert.equal(typeof res.body?.error?.message, "string", why(res, `${label} : format { error: { code, message } } attendu`));
  assert.equal(res.body.error.code, code, why(res, `${label} : code d'erreur ${code} attendu`));
}

// Connexion avec un compte du seed (mis en cache : une seule connexion par compte et par fichier)
const tokens = new Map();
export async function loginAs(role) {
  if (tokens.has(role)) return tokens.get(role);
  const u = seedUser(role);
  const res = await api("POST", "/auth/login", { body: { email: u.email, password: u.password } });
  expectStatus(res, 200, `Connexion du compte du seed ${u.email} / ${u.password}`);
  tokens.set(role, res.body.token);
  return res.body.token;
}

// Nouveau client inscrit et connecté
export async function newCustomer() {
  const email = uniqueEmail("client");
  const reg = await api("POST", "/auth/register", { body: { email, name: "Client Recette", password: "motdepasse123" } });
  expectStatus(reg, 201, "Inscription d'un nouveau client");
  const res = await api("POST", "/auth/login", { body: { email, password: "motdepasse123" } });
  expectStatus(res, 200, "Connexion du nouveau client");
  return { token: res.body.token, user: res.body.user };
}

// Toute la carte (en parcourant les pages)
export async function allDishes(query = "") {
  const items = [];
  for (let page = 1; page < 50; page++) {
    const res = await api("GET", `/dishes?pageSize=50&page=${page}${query ? `&${query}` : ""}`);
    expectStatus(res, 200, "GET /dishes");
    items.push(...res.body.items);
    if (items.length >= res.body.total || res.body.items.length === 0) break;
  }
  return items;
}

export async function dishByName(name) {
  const dish = (await allDishes()).find((d) => d.name === name);
  assert.ok(dish, `Le plat « ${name} » de donnees/menu.json est introuvable dans GET /dishes : le seed est-il chargé ?`);
  return dish;
}

export async function placeOrder(token, items, note) {
  return api("POST", "/orders", { token, body: note === undefined ? { items } : { items, note } });
}

export function checkDishShape(d, label = "Plat") {
  assert.equal(typeof d.id, "number", `${label} : id numérique attendu`);
  assert.equal(typeof d.name, "string", `${label} : name attendu`);
  assert.equal(typeof d.description, "string", `${label} : description (chaîne) attendue`);
  assert.ok(Number.isInteger(d.priceCents), `${label} : priceCents entier (centimes) attendu`);
  assert.equal(typeof d.available, "boolean", `${label} : available booléen attendu`);
  assert.equal(typeof d.category?.id, "number", `${label} : category { id, name } attendu`);
  assert.equal(typeof d.category?.name, "string", `${label} : category { id, name } attendu`);
  assert.ok(Array.isArray(d.allergens), `${label} : allergens (tableau) attendu`);
  for (const a of d.allergens) assert.ok(typeof a.code === "string" && typeof a.label === "string", `${label} : allergens = [{ code, label }]`);
}

export function checkOrderShape(o, label = "Commande") {
  for (const k of ["id", "totalCents"]) assert.ok(Number.isInteger(o[k]), `${label} : ${k} entier attendu`);
  assert.equal(typeof o.status, "string", `${label} : status attendu`);
  assert.ok(o.note === null || typeof o.note === "string", `${label} : note (chaîne ou null) attendue`);
  for (const k of ["createdAt", "updatedAt"]) assert.ok(!Number.isNaN(Date.parse(o[k])), `${label} : ${k} au format ISO attendu`);
  assert.ok(Number.isInteger(o.customer?.id) && typeof o.customer?.name === "string", `${label} : customer { id, name } attendu`);
  assert.ok(Array.isArray(o.items) && o.items.length > 0, `${label} : items attendu`);
  for (const i of o.items) {
    for (const k of ["dishId", "quantity", "unitPriceCents", "lineTotalCents"]) assert.ok(Number.isInteger(i[k]), `${label} : items[].${k} entier attendu`);
    assert.equal(typeof i.name, "string", `${label} : items[].name attendu`);
  }
  assert.ok(!("passwordHash" in (o.customer ?? {})) && !("email" in (o.customer ?? {})), `${label} : customer ne doit exposer que { id, name }`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
