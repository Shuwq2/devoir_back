// Point d'entrée du front : barre de navigation, routeur (#/…), session, panier.
import { api, session } from "./api.js";
import { cart, closeCart, openCart, renderCart } from "./cart.js";
import { h, showError, toast } from "./ui.js";
import { renderAdmin } from "./views/admin.js";
import { renderCarte } from "./views/carte.js";
import { renderCommande, renderCommandes } from "./views/commandes.js";
import { renderConnexion } from "./views/connexion.js";
import { renderCuisine } from "./views/cuisine.js";
import { renderStatut } from "./views/statut.js";

const view = document.getElementById("view");
let cleanups = [];

const ROUTES = [
  { path: /^\/?$/, render: (v) => renderCarte(v), nav: "Carte", href: "#/" },
  { path: /^\/commandes$/, render: (v, _m, c) => renderCommandes(v, c), nav: "Mes commandes", href: "#/commandes", roles: ["CUSTOMER", "STAFF", "ADMIN"] },
  { path: /^\/commandes\/(\d+)$/, render: (v, m, c) => renderCommande(v, m[1], c), roles: ["CUSTOMER", "STAFF", "ADMIN"] },
  { path: /^\/cuisine$/, render: (v, _m, c) => renderCuisine(v, c), nav: "Cuisine", href: "#/cuisine", roles: ["STAFF", "ADMIN"] },
  { path: /^\/admin$/, render: (v) => renderAdmin(v), nav: "Administration", href: "#/admin", roles: ["ADMIN"] },
  { path: /^\/connexion$/, render: (v) => renderConnexion(v) },
  { path: /^\/statut$/, render: (v) => renderStatut(v), nav: "Statut de l'API", href: "#/statut" },
];

function route() {
  cleanups.forEach((stop) => stop());
  cleanups = [];
  closeCart();
  const path = location.hash.replace(/^#/, "") || "/";
  const user = session.user;
  for (const r of ROUTES) {
    const m = path.match(r.path);
    if (!m) continue;
    if (r.roles && !user) {
      location.hash = "#/connexion";
      return;
    }
    if (r.roles && !r.roles.includes(user.role)) {
      toast("Cette page n'est pas accessible avec votre rôle", { type: "error" });
      location.hash = "#/";
      return;
    }
    drawChrome(r);
    r.render(view, m, (stop) => cleanups.push(stop));
    view.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    return;
  }
  location.hash = "#/";
}

function drawChrome(active) {
  const user = session.user;
  document.getElementById("nav").replaceChildren(
    ...ROUTES.filter((r) => r.nav && (!r.roles || (user && r.roles.includes(user.role)))).map((r) =>
      h("a", { href: r.href, class: r === active ? "active" : "" }, r.nav === "Mes commandes" && user?.role !== "CUSTOMER" ? "Commandes" : r.nav),
    ),
  );
  const count = cart.count;
  document.getElementById("session").replaceChildren(
    h("button", { class: "btn ghost small cart-button", onclick: openCart }, "Panier", count ? h("span", { class: "cart-count" }, count) : null),
    ...(user
      ? [h("span", { class: "chip" }, user.name, h("span", { class: "role" }, user.role)), h("button", { class: "btn ghost small", onclick: logout }, "Déconnexion")]
      : [h("a", { class: "btn primary small", href: "#/connexion" }, "Connexion")]),
  );
}

function logout() {
  session.clear();
  toast("À bientôt !");
  location.hash = "#/";
}

// Au démarrage : le token stocké est-il toujours valide ?
async function checkSession() {
  if (!session.token) return;
  try {
    const me = await api.get("/auth/me");
    if (me?.id) session.save(session.token, me);
  } catch (err) {
    if (err.status !== 401) showError(err);
  }
}

window.addEventListener("hashchange", route);
window.addEventListener("session", () => {
  const current = ROUTES.find((r) => (location.hash.replace(/^#/, "") || "/").match(r.path));
  drawChrome(current);
  if (!session.token && current?.roles) location.hash = "#/connexion";
});
window.addEventListener("cart", () => {
  renderCart();
  drawChrome(ROUTES.find((r) => (location.hash.replace(/^#/, "") || "/").match(r.path)));
});

checkSession().finally(route);
