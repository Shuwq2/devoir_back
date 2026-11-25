// Recette — Palier 4 : paiement via le simulateur (Adapter, délai, nouvelles tentatives, idempotence).
// Prérequis : le simulateur tourne (npm run paiement) et votre API est configurée pour l'appeler.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { PAY_SIM_URL, api, dishByName, expectError, expectStatus, loginAs, newCustomer, placeOrder } from "./lib.mjs";

const SIM_KEY = process.env.PAY_SIM_KEY ?? "sk_test_roulotte";

async function sim(path) {
  let res;
  try {
    res = await fetch(PAY_SIM_URL + path, { headers: { authorization: `Bearer ${SIM_KEY}` } });
  } catch {
    assert.fail(`Simulateur de paiement injoignable sur ${PAY_SIM_URL} : lancez « npm run paiement »`);
  }
  return res.json();
}

// Le simulateur garde l'historique tant qu'il tourne : si la base a été réinitialisée, une même
// référence order-<id> peut déjà avoir servi. On compare donc AVANT / APRÈS.
const attempts = async (orderId) => (await sim(`/v1/attempts?reference=order-${orderId}`)).attempts;
const charges = async (orderId) => (await sim(`/v1/charges?reference=order-${orderId}`)).items;
const succeeded = async (orderId) => (await charges(orderId)).filter((c) => c.status === "succeeded").length;

async function unpaidOrder() {
  const customer = await newCustomer();
  const frites = await dishByName("Frites maison");
  const res = await placeOrder(customer.token, [{ dishId: frites.id, quantity: 2 }]);
  expectStatus(res, 201, "Commande à payer");
  return { ...customer, order: res.body };
}

const pay = (token, orderId, paymentToken) => api("POST", `/orders/${orderId}/payment`, { token, body: { token: paymentToken } });

describe("Palier 4 · Paiement", () => {
  before(async () => {
    await sim("/v1/charges?reference=connexion"); // échoue tôt si le simulateur est arrêté
  });

  it("une nouvelle commande est UNPAID", async () => {
    const { order } = await unpaidOrder();
    assert.equal(order.paymentStatus, "UNPAID", "paymentStatus \"UNPAID\" attendu à la création");
  });

  it("tok_visa : 200, PAID, un paiement du bon montant chez le prestataire ; impossible de repayer (409)", async () => {
    const { token, order } = await unpaidOrder();
    const before = (await charges(order.id)).length;
    const res = await pay(token, order.id, "tok_visa");
    expectStatus(res, 200, "Paiement tok_visa");
    assert.equal(res.body.paymentStatus, "PAID");
    const done = await charges(order.id);
    assert.equal(done.length - before, 1, `Un paiement attendu pour order-${order.id} chez le prestataire (référence « order-<id> »)`);
    assert.equal(done.at(-1).amountCents, order.totalCents, "Montant envoyé = totalCents de la commande");
    assert.equal((await api("GET", `/orders/${order.id}`, { token })).body.paymentStatus, "PAID", "GET /orders/:id doit montrer PAID");
    expectError(await pay(token, order.id, "tok_visa"), 409, "CONFLICT", "Deuxième paiement de la même commande");
  });

  it("tok_declined : 402 PAYMENT_DECLINED, en une seule tentative, commande toujours UNPAID", async () => {
    const { token, order } = await unpaidOrder();
    const before = await attempts(order.id);
    expectError(await pay(token, order.id, "tok_declined"), 402, "PAYMENT_DECLINED", "Paiement refusé");
    assert.equal((await attempts(order.id)) - before, 1, "Un refus ne se réessaie pas");
    assert.equal((await api("GET", `/orders/${order.id}`, { token })).body.paymentStatus, "UNPAID");
    expectStatus(await pay(token, order.id, "tok_visa"), 200, "Nouveau paiement avec une autre carte");
  });

  it("tok_flaky : la nouvelle tentative réussit SANS débiter deux fois (Idempotency-Key)", async () => {
    const { token, order } = await unpaidOrder();
    const [attemptsBefore, paidBefore] = [await attempts(order.id), await succeeded(order.id)];
    expectStatus(await pay(token, order.id, "tok_flaky"), 200, "Paiement tok_flaky (réponse perdue puis nouvelle tentative)");
    assert.ok((await attempts(order.id)) - attemptsBefore >= 2, "Au moins 2 tentatives attendues");
    const debits = (await succeeded(order.id)) - paidBefore;
    assert.equal(debits, 1, `Le client a été débité ${debits} fois : réutilisez la même Idempotency-Key à chaque tentative`);
  });

  it("tok_down : 502 PAYMENT_PROVIDER_ERROR après 3 tentatives", async () => {
    const { token, order } = await unpaidOrder();
    const before = await attempts(order.id);
    expectError(await pay(token, order.id, "tok_down"), 502, "PAYMENT_PROVIDER_ERROR", "Prestataire en panne");
    assert.equal((await attempts(order.id)) - before, 3, "3 tentatives attendues");
  });

  it("tok_slow : 504 PAYMENT_PROVIDER_TIMEOUT après 3 tentatives, en moins de 10 s", async () => {
    const { token, order } = await unpaidOrder();
    const before = await attempts(order.id);
    const start = Date.now();
    expectError(await pay(token, order.id, "tok_slow"), 504, "PAYMENT_PROVIDER_TIMEOUT", "Prestataire trop lent");
    assert.ok(Date.now() - start < 10_000, "Chaque tentative doit être coupée au bout de 2 s");
    assert.equal((await attempts(order.id)) - before, 3, "3 tentatives attendues");
  });

  it("seul le client paie sa commande : 404 pour un autre client, 403 pour la cuisine ; 409 si annulée ; 400 sans jeton", async () => {
    const { token, order } = await unpaidOrder();
    const before = await attempts(order.id);
    const other = await newCustomer();
    expectError(await pay(other.token, order.id, "tok_visa"), 404, "NOT_FOUND", "Un autre client");
    expectError(await pay(await loginAs("STAFF"), order.id, "tok_visa"), 403, "FORBIDDEN", "La cuisine");
    expectError(await api("POST", `/orders/${order.id}/payment`, { token, body: {} }), 400, "VALIDATION_ERROR", "Corps sans token");
    await api("PATCH", `/orders/${order.id}/status`, { token, body: { status: "CANCELLED" } });
    expectError(await pay(token, order.id, "tok_visa"), 409, "CONFLICT", "Commande annulée");
    assert.equal((await attempts(order.id)) - before, 0, "Aucun appel au prestataire pour une commande refusée d'avance");
  });
});
