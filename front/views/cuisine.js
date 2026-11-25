// Écran de la cuisine : les commandes en cours, en trois colonnes, mises à jour en direct.
import { api } from "../api.js";
import { subscribe } from "../live.js";
import { confirmDialog, empty, h, paymentBadge, showError, timeAgo, toast } from "../ui.js";
import { setLive } from "./commandes.js";

const COLUMNS = [
  { status: "RECEIVED", title: "Reçues", next: "PREPARING", action: "Commencer" },
  { status: "PREPARING", title: "En préparation", next: "READY", action: "C'est prêt" },
  { status: "READY", title: "Prêtes", next: "PICKED_UP", action: "Remise au client" },
];

export async function renderCuisine(view, cleanup) {
  const orders = new Map();
  const fresh = new Set();
  const live = h("span", { class: "live" }, "…");
  const board = h("div", { class: "board" });
  view.replaceChildren(
    h("div", { class: "page-head" }, h("div", {}, h("div", { class: "eyebrow" }, "Cuisine"), h("h1", {}, "Commandes en cours"), h("p", {}, "Les plus anciennes en haut.")), live),
    board,
  );

  async function load() {
    try {
      const data = await api.get("/orders?status=RECEIVED,PREPARING,READY&sort=createdAt&pageSize=50");
      orders.clear();
      for (const o of data.items) orders.set(o.id, o);
      draw();
    } catch (err) {
      showError(err);
      board.replaceChildren(empty("Impossible de charger les commandes", err.message));
    }
  }

  function draw() {
    board.replaceChildren(
      ...COLUMNS.map((col) => {
        const items = [...orders.values()].filter((o) => o.status === col.status).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
        return h("section", { class: `column col-${col.status}` }, h("h2", {}, col.title, h("span", { class: "badge" }, items.length)), items.map((o) => ticket(o, col)));
      }),
    );
    fresh.clear();
  }

  function ticket(o, col) {
    return h(
      "article",
      { class: `ticket ${fresh.has(o.id) ? "fresh" : ""}` },
      h("div", { class: "row spread" }, h("strong", {}, `n° ${o.id} · ${o.customer.name}`), h("span", { class: "muted" }, timeAgo(o.createdAt))),
      h("ul", {}, o.items.map((i) => h("li", {}, `${i.quantity} × ${i.name}`))),
      o.note ? h("div", { class: "note" }, o.note) : null,
      h(
        "div",
        { class: "row spread" },
        paymentBadge(o) ?? h("span"),
        h(
          "div",
          { class: "row" },
          h("button", { class: "btn ghost small", onclick: () => confirmDialog(`Annuler la commande n° ${o.id} ?`) && move(o, "CANCELLED") }, "Annuler"),
          h("button", { class: "btn primary small", onclick: () => move(o, col.next) }, col.action),
        ),
      ),
    );
  }

  async function move(o, status) {
    try {
      const updated = await api.patch(`/orders/${o.id}/status`, { status });
      upsert(updated);
    } catch (err) {
      showError(err);
      load();
    }
  }

  function upsert(o) {
    if (["RECEIVED", "PREPARING", "READY"].includes(o.status)) orders.set(o.id, o);
    else orders.delete(o.id);
    draw();
  }

  cleanup(
    subscribe({
      onEvent: (type, data) => {
        if (!data?.id) return;
        if (type === "order.created") {
          fresh.add(data.id);
          toast(`Nouvelle commande n° ${data.id} (${data.customer?.name ?? "client"})`);
        }
        if (type === "order.created" || type === "order.updated") upsert(data);
      },
      onPoll: load,
      onMode: (m) => setLive(live, m),
    }),
  );
  load();
}
