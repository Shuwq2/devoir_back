// La carte : catégories, filtres allergènes, recherche, pagination.
import { api, assetUrl, session } from "../api.js";
import { cart } from "../cart.js";
import { empty, euros, h, initials, loading, showError } from "../ui.js";

const state = { category: null, allergenFree: new Set(), q: "", onlyAvailable: true, page: 1 };
const PAGE_SIZE = 12;

export async function renderCarte(view) {
  view.replaceChildren(loading());
  let categories, allergens;
  try {
    [categories, allergens] = await Promise.all([api.get("/categories"), api.get("/allergens")]);
  } catch (err) {
    showError(err);
    view.replaceChildren(empty("La carte est inaccessible", "Vérifiez que l'API tourne, puis consultez la page « Statut de l'API »."));
    return;
  }

  const list = h("div");
  const search = h("input", { type: "search", placeholder: "Rechercher un plat…", value: state.q });
  let debounce;
  search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.q = search.value.trim();
      state.page = 1;
      load();
    }, 250);
  });

  const tabs = h(
    "div",
    { class: "tabs", role: "tablist" },
    [{ id: null, name: "Toute la carte" }, ...categories].map((c) =>
      h("button", { class: `tab ${state.category === c.id ? "active" : ""}`, onclick: () => ((state.category = c.id), (state.page = 1), renderCarte(view)) }, c.name),
    ),
  );

  const chips = h(
    "div",
    { class: "chips" },
    h("span", { class: "hint" }, "Sans :"),
    allergens.map((a) =>
      h(
        "button",
        {
          class: `chip-toggle ${state.allergenFree.has(a.code) ? "active" : ""}`,
          onclick: (e) => {
            state.allergenFree.has(a.code) ? state.allergenFree.delete(a.code) : state.allergenFree.add(a.code);
            e.currentTarget.classList.toggle("active");
            state.page = 1;
            load();
          },
        },
        a.label,
      ),
    ),
  );

  const available = h("input", { type: "checkbox", checked: state.onlyAvailable, onchange: (e) => ((state.onlyAvailable = e.target.checked), (state.page = 1), load()) });

  view.replaceChildren(
    h(
      "section",
      { class: "hero" },
      h("div", { class: "stripes" }),
      h(
        "div",
        { style: "position:relative" },
        h("div", { class: "eyebrow" }, "Click & collect"),
        h("h1", {}, "Commandez en ligne, ", h("em", {}, "récupérez chaud"), "."),
        h("p", {}, "Choisissez vos plats, payez si vous le souhaitez, et suivez la préparation en direct jusqu'au comptoir de la roulotte."),
      ),
    ),
    h("section", { class: "filters" }, tabs, h("div", { class: "toolbar" }, search, h("label", { class: "check" }, available, "Plats disponibles uniquement")), chips),
    list,
  );

  async function load() {
    const params = new URLSearchParams({ page: String(state.page), pageSize: String(PAGE_SIZE) });
    if (state.category) params.set("category", String(state.category));
    if (state.allergenFree.size) params.set("allergenFree", [...state.allergenFree].join(","));
    if (state.q) params.set("q", state.q);
    if (state.onlyAvailable) params.set("available", "true");
    list.replaceChildren(loading());
    try {
      const page = await api.get(`/dishes?${params}`);
      list.replaceChildren(dishGrid(page.items), pager(page));
    } catch (err) {
      showError(err);
      list.replaceChildren(empty("Impossible de charger les plats", err.message));
    }
  }

  function pager({ total, page, pageSize }) {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    if (pages === 1) return h("p", { class: "pager" }, `${total} plat(s)`);
    return h(
      "div",
      { class: "pager" },
      h("button", { class: "btn ghost small", disabled: page <= 1, onclick: () => ((state.page = page - 1), load()) }, "← Précédent"),
      h("span", {}, `Page ${page} / ${pages} · ${total} plat(s)`),
      h("button", { class: "btn ghost small", disabled: page >= pages, onclick: () => ((state.page = page + 1), load()) }, "Suivant →"),
    );
  }

  load();
}

function dishGrid(dishes) {
  if (!dishes.length) return empty("Aucun plat ne correspond", "Essayez d'enlever un filtre.");
  return h("div", { class: "grid" }, dishes.map(dishCard));
}

function dishCard(d) {
  const soldOut = d.stock === 0;
  const orderable = d.available && !soldOut;
  const img = d.imageUrl ? h("img", { src: assetUrl(d.imageUrl), alt: d.name, loading: "lazy", onerror: (e) => e.target.replaceWith(h("span", { class: "initials" }, initials(d.name))) }) : h("span", { class: "initials" }, initials(d.name));
  let badge = null;
  if (!d.available) badge = h("span", { class: "badge bad" }, "Indisponible");
  else if (soldOut) badge = h("span", { class: "badge bad" }, "Épuisé");
  else if (typeof d.stock === "number" && d.stock <= 5) badge = h("span", { class: "badge warn" }, `Plus que ${d.stock}`);

  return h(
    "article",
    { class: `dish ${orderable ? "" : "off"}` },
    h("div", { class: "dish-photo" }, img, badge),
    h(
      "div",
      { class: "dish-body" },
      h("div", { class: "dish-top" }, h("h3", {}, d.name), h("span", { class: "price" }, euros(d.priceCents))),
      d.description ? h("p", { class: "desc" }, d.description) : null,
      d.allergens?.length ? h("div", { class: "allergens" }, d.allergens.map((a) => h("span", { class: "allergen" }, a.label))) : h("div", { class: "allergens" }, h("span", { class: "allergen" }, "Sans allergène majeur")),
      h(
        "div",
        { class: "dish-foot" },
        h("span", { class: "muted" }, d.category?.name ?? ""),
        h("button", { class: "btn primary small", disabled: !orderable, onclick: () => cart.add(d), title: session.token ? "" : "Vous pourrez vous connecter au moment de commander" }, "Ajouter"),
      ),
    ),
  );
}
