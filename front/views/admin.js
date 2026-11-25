// Administration de la carte : créer, modifier, rendre indisponible, photo, supprimer.
import { api, assetUrl } from "../api.js";
import { confirmDialog, empty, euros, h, loading, modal, showError, toast } from "../ui.js";

export async function renderAdmin(view) {
  view.replaceChildren(loading());
  let categories, allergens;
  try {
    [categories, allergens] = await Promise.all([api.get("/categories"), api.get("/allergens")]);
  } catch (err) {
    showError(err);
    view.replaceChildren(empty("Carte inaccessible", err.message));
    return;
  }
  const table = h("div", { class: "panel" }, loading());
  view.replaceChildren(
    h(
      "div",
      { class: "page-head" },
      h("div", {}, h("div", { class: "eyebrow" }, "Administration"), h("h1", {}, "La carte"), h("p", {}, "Un plat déjà commandé ne peut pas être supprimé : rendez-le indisponible.")),
      h("button", { class: "btn primary", onclick: () => edit() }, "+ Nouveau plat"),
    ),
    table,
  );

  async function load() {
    try {
      const dishes = [];
      for (let page = 1; page < 20; page++) {
        const data = await api.get(`/dishes?pageSize=50&page=${page}`);
        dishes.push(...data.items);
        if (dishes.length >= data.total || !data.items.length) break;
      }
      table.replaceChildren(
        h(
          "table",
          {},
          h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "Plat"), h("th", {}, "Catégorie"), h("th", { class: "num" }, "Prix"), h("th", { class: "num" }, "Stock"), h("th", {}, "Disponible"), h("th", {}, ""))),
          h("tbody", {}, dishes.map(row)),
        ),
      );
    } catch (err) {
      showError(err);
      table.replaceChildren(empty("Impossible de charger les plats", err.message));
    }
  }

  function row(d) {
    const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true, onchange: (e) => upload(d, e.target.files[0]) });
    return h(
      "tr",
      {},
      h("td", {}, d.imageUrl ? h("img", { class: "thumb", src: assetUrl(d.imageUrl), alt: "" }) : h("span", { class: "thumb" })),
      h("td", {}, h("strong", {}, d.name), h("div", { class: "muted" }, d.allergens?.map((a) => a.label).join(", ") || "—")),
      h("td", {}, d.category?.name),
      h("td", { class: "num" }, euros(d.priceCents)),
      h("td", { class: "num" }, d.stock === undefined ? "—" : d.stock === null ? "∞" : d.stock),
      h("td", {}, h("input", { type: "checkbox", checked: d.available, "aria-label": "Disponible", onchange: (e) => patch(d, { available: e.target.checked }) })),
      h(
        "td",
        { class: "num" },
        h(
          "div",
          { class: "row", style: "justify-content:flex-end;flex-wrap:nowrap" },
          h("button", { class: "btn ghost small", onclick: () => edit(d) }, "Modifier"),
          h("button", { class: "btn ghost small", onclick: () => file.click() }, "Photo"),
          file,
          h("button", { class: "btn ghost small", onclick: () => remove(d) }, "Supprimer"),
        ),
      ),
    );
  }

  async function edit(d) {
    const fields = h(
      "div",
      { class: "stack" },
      h("label", {}, "Nom", h("input", { type: "text", name: "name", required: true, value: d?.name ?? "" })),
      h("label", {}, "Description", h("textarea", { name: "description" }, d?.description ?? "")),
      h(
        "div",
        { class: "grid-2" },
        h("label", {}, "Prix (€)", h("input", { type: "number", name: "price", required: true, min: "0.5", max: "100", step: "0.05", value: d ? (d.priceCents / 100).toFixed(2) : "" })),
        h("label", {}, "Catégorie", h("select", { name: "categoryId" }, categories.map((c) => h("option", { value: c.id, selected: d?.category?.id === c.id }, c.name)))),
      ),
      h(
        "div",
        { class: "grid-2" },
        h("label", {}, "Stock", h("input", { type: "number", name: "stock", min: "0", step: "1", value: d?.stock ?? "" }), h("span", { class: "hint" }, "Vide = illimité")),
        h("label", { class: "check" }, h("input", { type: "checkbox", name: "available", checked: d ? d.available : true }), "Disponible"),
      ),
      h(
        "fieldset",
        { class: "stack", style: "border:1px solid var(--line);border-radius:10px" },
        h("legend", {}, "Allergènes"),
        h("div", { class: "allergen-picker" }, allergens.map((a) => h("label", {}, h("input", { type: "checkbox", name: "allergens", value: a.code, checked: d?.allergens?.some((x) => x.code === a.code) }), a.label))),
      ),
    );
    const data = await modal(d ? `Modifier « ${d.name} »` : "Nouveau plat", fields, d ? "Enregistrer" : "Créer");
    if (!data) return;
    const stock = String(data.get("stock") ?? "").trim();
    const body = {
      name: String(data.get("name")).trim(),
      description: String(data.get("description") ?? "").trim(),
      priceCents: Math.round(Number(data.get("price")) * 100),
      categoryId: Number(data.get("categoryId")),
      allergens: data.getAll("allergens").map(String),
      available: data.get("available") === "on",
      stock: stock === "" ? null : Number(stock),
    };
    try {
      if (d) await api.patch(`/dishes/${d.id}`, body);
      else await api.post("/dishes", body);
      toast(d ? "Plat modifié" : "Plat créé", { type: "success" });
      load();
    } catch (err) {
      showError(err);
    }
  }

  async function patch(d, body) {
    try {
      await api.patch(`/dishes/${d.id}`, body);
      toast("Plat mis à jour", { type: "success" });
    } catch (err) {
      showError(err);
    }
    load();
  }

  async function upload(d, file) {
    if (!file) return;
    const form = new FormData();
    form.append("image", file);
    try {
      await api.put(`/dishes/${d.id}/image`, form);
      toast("Photo enregistrée", { type: "success" });
      load();
    } catch (err) {
      showError(err);
    }
  }

  async function remove(d) {
    if (!confirmDialog(`Supprimer « ${d.name} » ?`)) return;
    try {
      await api.del(`/dishes/${d.id}`);
      toast("Plat supprimé", { type: "success" });
      load();
    } catch (err) {
      showError(err);
    }
  }

  load();
}
