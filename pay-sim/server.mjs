// Simulateur de prestataire de paiement (palier 4) — aucune dépendance, Node.js 22.
// Lancement : npm run paiement   (ou : node pay-sim/server.mjs)
// NE PAS MODIFIER : votre API doit s'adapter à lui, comme à un vrai prestataire.
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4010);
const SECRET_KEY = process.env.PAY_SIM_KEY ?? "sk_test_roulotte";
const SLOW_MS = Number(process.env.PAY_SIM_SLOW_MS ?? 5000);

const charges = []; // paiements enregistrés
const attempts = new Map(); // référence → nombre d'appels reçus
const idempotency = new Map(); // Idempotency-Key → { fingerprint, status, body }
const flakyWithoutKey = new Map(); // référence → appels tok_flaky reçus sans Idempotency-Key

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

function send(res, status, body) {
  if (res.destroyed) return;
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function log(message) {
  console.log(`${now().slice(11, 19)}  ${message}`);
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return null;
  }
}

function newCharge(body, status, extra = {}) {
  const charge = { id: `ch_${randomUUID().replaceAll("-", "").slice(0, 16)}`, status, amountCents: body.amountCents, currency: body.currency, reference: body.reference, createdAt: now(), ...extra };
  charges.push(charge);
  return charge;
}

async function createCharge(req, res) {
  const body = await readJson(req);
  if (!body || !Number.isInteger(body.amountCents) || body.amountCents <= 0 || body.currency !== "EUR" || typeof body.reference !== "string" || typeof body.token !== "string") {
    log("✗ POST /v1/charges : corps invalide → 400");
    return send(res, 400, { error: { type: "invalid_request_error", message: "Attendu : { amountCents (entier > 0), currency: \"EUR\", reference, token }" } });
  }
  const key = req.headers["idempotency-key"];
  attempts.set(body.reference, (attempts.get(body.reference) ?? 0) + 1);
  const n = attempts.get(body.reference);
  const label = `POST /v1/charges ${body.reference} ${body.token} (tentative ${n}${key ? `, clé ${String(key).slice(0, 12)}…` : ", SANS Idempotency-Key"})`;

  // Idempotence : même clé + même requête → même réponse, sans nouveau paiement
  const fingerprint = JSON.stringify([body.amountCents, body.currency, body.reference, body.token]);
  if (key && idempotency.has(key)) {
    const stored = idempotency.get(key);
    if (stored.fingerprint !== fingerprint) {
      log(`✗ ${label} → 422 (clé déjà utilisée pour une autre requête)`);
      return send(res, 422, { error: { type: "idempotency_error", message: "Cette Idempotency-Key a déjà servi pour une autre requête" } });
    }
    log(`↺ ${label} → ${stored.status} (rejouée grâce à l'Idempotency-Key)`);
    return send(res, stored.status, stored.body);
  }
  const remember = (status, payload) => key && idempotency.set(key, { fingerprint, status, body: payload });

  switch (body.token) {
    case "tok_visa": {
      const charge = newCharge(body, "succeeded");
      remember(201, charge);
      log(`✓ ${label} → 201 payé`);
      return send(res, 201, charge);
    }
    case "tok_flaky": {
      // Le paiement EST enregistré… mais la réponse se « perd » une fois par référence
      const charge = newCharge(body, "succeeded");
      remember(201, charge);
      // Avec une clé : la première réponse se perd, les rejeux réussissent (traités plus haut).
      // Sans clé : un appel sur deux se perd… et chaque appel débite à nouveau.
      const calls = flakyWithoutKey.get(body.reference) ?? 0;
      if (!key) flakyWithoutKey.set(body.reference, calls + 1);
      if (key || calls % 2 === 0) {
        log(`⚡ ${label} → 503 (paiement ENREGISTRÉ mais réponse perdue : rejouez avec la même Idempotency-Key)`);
        return send(res, 503, { error: { type: "api_error", message: "Service momentanément indisponible" } });
      }
      log(`✓ ${label} → 201 payé`);
      return send(res, 201, charge);
    }
    case "tok_slow": {
      log(`… ${label} → réponse dans ${SLOW_MS / 1000} s`);
      await sleep(SLOW_MS);
      if (res.destroyed || req.socket.destroyed) {
        log(`  ${body.reference} : le client a abandonné avant la réponse (aucun paiement)`);
        return;
      }
      const charge = newCharge(body, "succeeded");
      remember(201, charge);
      return send(res, 201, charge);
    }
    case "tok_down":
      log(`✗ ${label} → 500 (panne du prestataire)`);
      return send(res, 500, { error: { type: "api_error", message: "Erreur interne du prestataire" } });
    default: {
      const reason = body.token === "tok_declined" ? "insufficient_funds" : "unknown_token";
      const charge = newCharge(body, "declined", { declineReason: reason });
      remember(402, charge);
      log(`✗ ${label} → 402 refusé (${reason})`);
      return send(res, 402, charge);
    }
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    return res.end(`Simulateur de paiement — La Roulotte\nPOST /v1/charges · GET /v1/charges?reference= · GET /v1/attempts?reference=\nVoir pay-sim/README.md\n`);
  }
  if (req.headers.authorization !== `Bearer ${SECRET_KEY}`) {
    log(`✗ ${req.method} ${url.pathname} → 401 (clé secrète absente ou invalide)`);
    return send(res, 401, { error: { type: "authentication_error", message: "Clé secrète invalide" } });
  }
  if (req.method === "POST" && url.pathname === "/v1/charges") return createCharge(req, res);
  if (req.method === "GET" && url.pathname === "/v1/charges") {
    const reference = url.searchParams.get("reference");
    return send(res, 200, { items: charges.filter((c) => !reference || c.reference === reference) });
  }
  if (req.method === "GET" && url.pathname === "/v1/attempts") {
    const reference = url.searchParams.get("reference") ?? "";
    return send(res, 200, { reference, attempts: attempts.get(reference) ?? 0 });
  }
  return send(res, 404, { error: { type: "invalid_request_error", message: "Route inconnue" } });
});

server.listen(PORT, () => {
  console.log(`Simulateur de paiement sur http://localhost:${PORT} (clé secrète : ${SECRET_KEY})`);
  console.log("Jetons : tok_visa · tok_declined · tok_flaky · tok_slow · tok_down");
});
