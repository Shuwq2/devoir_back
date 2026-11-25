// Mes commandes : liste et suivi en direct d'une commande.
import { api, session } from "../api.js";
import { subscribe } from "../live.js";
import { STATUS, confirmDialog, empty, euros, h, loading, paymentBadge, showError, statusBadge, timeAgo, toast } from "../ui.js";

const STEPS = ["RECEIVED", "PREPARING", "READY", "PICKED_UP"];
const TEST_CARDS = [
  ["tok_visa", "Carte acceptée"],
  ["tok_declined", "Carte refusée"],
  ["tok_flaky", "Réseau capricieux"],
  ["tok_slow", "Banque très lente"],
  ["tok_down", "Banque en panne"],
];

export async function renderCommandes(view, cleanup) {
  const list = h("div", { class: "orders" }, loading());
  const live = h("span", { class: "live" }, "…");
  view.replaceChildren(
    h("div", { class: "page-head" }, h("div", {}, h("div", { class: "eyebrow" }, "Suivi"), h("h1", {}, session.user?.role === "CUSTOMER" ? "Mes commandes" : "Commandes"), h("p", {}, "Les plus récentes d'abord.")), live),
    list,
  );

  let page = 1;
  async function load() {
    try {
      const data = await api.get(`/orders?page=${page}&pageSize=10&sort=-createdAt`);
      if (!data.items.length) return list.replaceChildren(empty("Aucune commande pour l'instant", h("a", { href: "#/" }, "Voir la carte")));
      const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
      const cards = data.items.map((o) =>
          h(
            "a",
            { class: "order-card", href: `#/commandes/${o.id}` },
            h("span", { class: "order-num" }, `n° ${o.id}`),
            h("div", {}, h("div", {}, o.items.map((i) => `${i.quantity} × ${i.name}`).join(" · ")), h("div", { class: "muted" }, timeAgo(o.createdAt))),
            h("div", { class: "row" }, paymentBadge(o), statusBadge(o.status), h("strong", {}, euros(o.totalCents))),
          ),
      );
      const pager =
        pages > 1
          ? h("div", { class: "pager" }, h("button", { class: "btn ghost small", disabled: page <= 1, onclick: () => (page--, load()) }, "←"), `Page ${page} / ${pages}`, h("button", { class: "btn ghost small", disabled: page >= pages, onclick: () => (page++, load()) }, "→"))
          : null;
      list.replaceChildren(...cards, ...(pager ? [pager] : []));
    } catch (err) {
      showError(err);
      list.replaceChildren(empty("Impossible de charger les commandes", err.message));
    }
  }

  cleanup(subscribe({ onEvent: () => load(), onPoll: load, onMode: (m) => setLive(live, m) }));
  load();
}

export async function renderCommande(view, id, cleanup) {
  view.replaceChildren(loading());
  const live = h("span", { class: "live" }, "…");
  let order;

  async function load() {
    try {
      order = await api.get(`/orders/${id}`);
      draw();
    } catch (err) {
      showError(err);
      view.replaceChildren(empty(err.status === 404 ? "Commande introuvable" : "Erreur", err.message));
    }
  }

  function draw() {
    const cancelled = order.status === "CANCELLED";
    const current = STEPS.indexOf(order.status);
    const isOwner = session.user?.id === order.customer.id;
    const card = h("select", {}, TEST_CARDS.map(([value, label]) => h("option", { value }, `${label} (${value})`)));
    const payButton = h("button", { class: "btn primary", onclick: () => pay(card.value, payButton) }, `Payer ${euros(order.totalCents)}`);

    view.replaceChildren(
      h(
        "div",
        { class: "page-head" },
        h("div", {}, h("div", { class: "eyebrow" }, h("a", { href: "#/commandes" }, "← Commandes")), h("h1", {}, `Commande n° ${order.id}`), h("p", {}, `Passée ${timeAgo(order.createdAt)} par ${order.customer.name}`)),
        h("div", { class: "row" }, live, paymentBadge(order), statusBadge(order.status)),
      ),
      h(
        "div",
        { class: "panel" },
        cancelled
          ? h("p", { class: "badge bad" }, "Cette commande a été annulée.")
          : h(
              "div",
              { class: "stepper" },
              STEPS.map((s, i) => h("div", { class: `step ${i < current ? "done" : ""} ${i === current ? "current" : ""}` }, h("span", { class: "dot" }, i < current ? "✓" : String(i + 1)), STATUS[s].label)),
            ),
        h(
          "table",
          {},
          h("thead", {}, h("tr", {}, h("th", {}, "Plat"), h("th", { class: "num" }, "Qté"), h("th", { class: "num" }, "Prix unitaire"), h("th", { class: "num" }, "Total"))),
          h(
            "tbody",
            {},
            order.items.map((i) => h("tr", {}, h("td", {}, i.name), h("td", { class: "num" }, i.quantity), h("td", { class: "num" }, euros(i.unitPriceCents)), h("td", { class: "num" }, euros(i.lineTotalCents)))),
            h("tr", {}, h("td", { colspan: 3 }, h("strong", {}, "Total")), h("td", { class: "num" }, h("strong", {}, euros(order.totalCents)))),
          ),
        ),
        order.note ? h("p", {}, h("strong", {}, "Remarque : "), order.note) : null,
        h(
          "div",
          { class: "row", style: "margin-top:16px" },
          isOwner && order.paymentStatus === "UNPAID" && !cancelled ? [h("label", { class: "check" }, "Carte de test", card), payButton] : null,
          isOwner && order.status === "RECEIVED" ? h("button", { class: "btn danger", onclick: cancel }, "Annuler la commande") : null,
        ),
      ),
    );
  }

  async function cancel() {
    if (!confirmDialog("Annuler cette commande ?")) return;
    try {
      order = await api.patch(`/orders/${id}/status`, { status: "CANCELLED" });
      toast("Commande annulée", { type: "success" });
      draw();
    } catch (err) {
      showError(err);
      load();
    }
  }

  async function pay(token, button) {
    button.disabled = true;
    button.textContent = "Paiement en cours…";
    try {
      order = await api.post(`/orders/${id}/payment`, { token });
      toast("Paiement accepté, merci !", { type: "success" });
    } catch (err) {
      showError(err);
    }
    draw();
  }

  cleanup(
    subscribe({
      onEvent: (type, data) => {
        if (type === "order.updated" && data?.id === Number(id)) {
          if (data.status !== order?.status && data.status === "READY") toast(`Votre commande n° ${id} est prête !`, { type: "success" });
          order = data;
          draw();
        }
      },
      onPoll: load,
      onMode: (m) => setLive(live, m),
    }),
  );
  load();
}

export function setLive(el, mode) {
  el.className = `live ${mode === "sse" ? "on" : ""}`;
  el.textContent = mode === "sse" ? "En direct (SSE)" : "Actualisation toutes les 5 s";
}
