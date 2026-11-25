// Panier (gardé dans le navigateur) et son panneau latéral.
import { api, session } from "./api.js";
import { euros, h, showError, toast } from "./ui.js";

const KEY = "roulotte.cart";
let problems = new Map(); // dishId → message renvoyé par l'API

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? { lines: [], note: "" };
  } catch {
    return { lines: [], note: "" };
  }
}

function write(cart) {
  localStorage.setItem(KEY, JSON.stringify(cart));
  window.dispatchEvent(new Event("cart"));
}

export const cart = {
  get lines() {
    return read().lines;
  },
  get count() {
    return read().lines.reduce((n, l) => n + l.quantity, 0);
  },
  add(dish) {
    const c = read();
    const line = c.lines.find((l) => l.dishId === dish.id);
    if (line) line.quantity = Math.min(10, line.quantity + 1);
    else c.lines.push({ dishId: dish.id, name: dish.name, priceCents: dish.priceCents, quantity: 1 });
    problems.delete(dish.id);
    write(c);
    toast(`${dish.name} ajouté au panier`);
  },
  change(dishId, delta) {
    const c = read();
    const line = c.lines.find((l) => l.dishId === dishId);
    if (!line) return;
    line.quantity = Math.max(0, Math.min(10, line.quantity + delta));
    c.lines = c.lines.filter((l) => l.quantity > 0);
    problems.delete(dishId);
    write(c);
  },
  setNote(note) {
    const c = read();
    c.note = note;
    localStorage.setItem(KEY, JSON.stringify(c));
  },
  clear() {
    problems = new Map();
    write({ lines: [], note: "" });
  },
};

export function openCart() {
  const panel = document.getElementById("cart");
  panel.hidden = false;
  document.body.append(h("div", { class: "backdrop", id: "cart-backdrop", onclick: closeCart }));
  renderCart();
}

export function closeCart() {
  document.getElementById("cart").hidden = true;
  document.getElementById("cart-backdrop")?.remove();
}

export function renderCart() {
  const panel = document.getElementById("cart");
  if (panel.hidden) return;
  const c = read();
  const total = c.lines.reduce((s, l) => s + l.priceCents * l.quantity, 0);
  const note = h("textarea", { maxlength: 200, placeholder: "Une remarque ? (sans oignons, allergie…)", oninput: (e) => cart.setNote(e.target.value) });
  note.value = c.note ?? "";
  const submit = h("button", { class: "btn primary block", disabled: c.lines.length === 0, onclick: () => placeOrder(submit) }, session.token ? "Commander" : "Se connecter pour commander");

  panel.replaceChildren(
    h("div", { class: "cart-head" }, h("h2", {}, "Mon panier"), h("button", { class: "btn ghost small", onclick: closeCart }, "Fermer")),
    h(
      "div",
      { class: "cart-lines" },
      c.lines.length === 0
        ? h("p", { class: "muted" }, "Votre panier est vide.")
        : c.lines.map((l) =>
            h(
              "div",
              { class: "cart-line" },
              h("div", {}, h("strong", {}, l.name), h("div", { class: "muted" }, `${euros(l.priceCents)} l'unité (prix indicatif)`)),
              h("div", { class: "qty" }, h("button", { onclick: () => cart.change(l.dishId, -1), "aria-label": "Retirer un" }, "−"), h("span", {}, l.quantity), h("button", { onclick: () => cart.change(l.dishId, 1), "aria-label": "Ajouter un" }, "+")),
              problems.has(l.dishId) ? h("div", { class: "problem field-error" }, problems.get(l.dishId)) : null,
            ),
          ),
    ),
    h("div", { class: "cart-foot" }, note, h("div", { class: "total" }, h("span", {}, "Total estimé"), h("span", {}, euros(total))), submit),
  );
}

async function placeOrder(button) {
  if (!session.token) {
    closeCart();
    location.hash = "#/connexion";
    return;
  }
  const c = read();
  button.disabled = true;
  try {
    const order = await api.post("/orders", { items: c.lines.map(({ dishId, quantity }) => ({ dishId, quantity })), ...(c.note?.trim() ? { note: c.note.trim() } : {}) });
    cart.clear();
    closeCart();
    toast(`Commande n° ${order.id} envoyée en cuisine !`, { type: "success" });
    location.hash = `#/commandes/${order.id}`;
  } catch (err) {
    // On rattache les refus de l'API aux lignes du panier
    if (err.code === "DISH_UNAVAILABLE" && Array.isArray(err.details)) {
      problems = new Map(err.details.map((d) => [d.dishId, d.reason === "NOT_FOUND" ? "Ce plat n'existe plus" : "Ce plat n'est plus disponible"]));
    } else if (err.code === "OUT_OF_STOCK" && Array.isArray(err.details)) {
      problems = new Map(err.details.map((d) => [d.dishId, `Plus que ${d.available} portion(s) disponible(s)`]));
    }
    showError(err);
    button.disabled = false;
    renderCart();
  }
}
