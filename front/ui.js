// Petits outils d'interface. Tout le texte venant de l'API passe par textContent (jamais innerHTML).

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "class") el.className = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export const euros = (cents) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format((cents ?? 0) / 100);

export const STATUS = {
  RECEIVED: { label: "Reçue", tone: "info" },
  PREPARING: { label: "En préparation", tone: "warn" },
  READY: { label: "Prête !", tone: "good" },
  PICKED_UP: { label: "Retirée", tone: "" },
  CANCELLED: { label: "Annulée", tone: "bad" },
};

export function statusBadge(status) {
  const s = STATUS[status] ?? { label: status, tone: "" };
  return h("span", { class: `badge ${s.tone}` }, s.label);
}

export function paymentBadge(order) {
  if (!order.paymentStatus) return null; // palier 4 pas encore atteint
  return order.paymentStatus === "PAID" ? h("span", { class: "badge good" }, "Payée") : h("span", { class: "badge warn" }, "À payer");
}

export function timeAgo(iso) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export function toast(message, { type = "info", code, details } = {}) {
  const list = Array.isArray(details)
    ? h("ul", {}, details.slice(0, 6).map((d) => h("li", {}, d.path ? `${d.path} : ${d.message ?? ""}` : d.message ?? JSON.stringify(d))))
    : null;
  const el = h("div", { class: `toast ${type}` }, h("div", {}, message), list, code ? h("code", {}, code) : null);
  const box = document.getElementById("toasts");
  box.append(el);
  while (box.children.length > 3) box.firstElementChild.remove(); // au plus 3 messages à la fois
  setTimeout(() => el.remove(), type === "error" ? 7000 : 2500);
}

export function showError(err) {
  toast(err.message, { type: "error", code: err.status ? `${err.status} ${err.code}` : err.code, details: err.code === "VALIDATION_ERROR" ? err.details : undefined });
}

export function empty(title, text) {
  return h("div", { class: "empty" }, h("strong", {}, title), text);
}

export function loading() {
  return h("p", { class: "muted" }, "Chargement…");
}

export function confirmDialog(message) {
  return window.confirm(message);
}

// Formulaire en modale ; resolve(FormData) ou null si annulé
export function modal(title, fields, submitLabel = "Enregistrer") {
  return new Promise((resolve) => {
    const dialog = h("dialog", {});
    const form = h(
      "form",
      { method: "dialog" },
      h("h2", {}, title),
      fields,
      h("div", { class: "row spread" }, h("button", { class: "btn ghost", value: "cancel", type: "button", onclick: () => dialog.close("cancel") }, "Annuler"), h("button", { class: "btn primary", value: "ok" }, submitLabel)),
    );
    dialog.append(form);
    document.body.append(dialog);
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "ok" ? new FormData(form) : null);
      dialog.remove();
    });
    dialog.showModal();
  });
}

export function initials(name) {
  return name
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}
