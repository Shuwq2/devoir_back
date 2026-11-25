// Statut de l'API : adresse de l'API, et détection des routes de chaque palier.
// On se connecte avec le client du seed, puis on envoie à chaque route une requête volontairement
// incomplète : une route codée la refuse (400, 403…), une route absente répond 404.
import { apiUrl, setApiUrl } from "../api.js";
import { h } from "../ui.js";

const exists = (r) => [400, 403, 415, 422].includes(r.status); // la route existe et a refusé notre requête volontairement incomplète

// [libellé, méthode, chemin, test, avec le token du client de démonstration ?]
const PROBES = [
  {
    palier: 1,
    title: "Palier 1 — la carte, les comptes, les commandes",
    checks: [
      ["GET /health", "GET", "/health", (r) => r.status === 200],
      ["GET /categories", "GET", "/categories", (r) => r.status === 200 && Array.isArray(r.json)],
      ["GET /allergens", "GET", "/allergens", (r) => r.status === 200 && Array.isArray(r.json)],
      ["GET /dishes (paginé)", "GET", "/dishes?pageSize=1", (r) => r.status === 200 && Array.isArray(r.json?.items) && typeof r.json?.total === "number"],
      ["POST /auth/login (compte client du seed)", "LOGIN", "/auth/login", (r) => r.status === 200 && typeof r.json?.token === "string"],
      ["GET /auth/me", "GET", "/auth/me", (r) => r.status === 200 && r.json?.role === "CUSTOMER", true],
      ["GET /orders", "GET", "/orders", (r) => r.status === 200 && Array.isArray(r.json?.items), true],
      ["Format d'erreur { error: { code, message } }", "GET", "/route-inconnue", (r) => r.status === 404 && typeof r.json?.error?.code === "string" && typeof r.json?.error?.message === "string"],
    ],
  },
  {
    palier: 2,
    title: "Palier 2 — cuisine et administration",
    checks: [
      ["PATCH /orders/:id/status", "PATCH", "/orders/abc/status", exists, true],
      ["POST /dishes", "POST", "/dishes", exists, true],
      ["PATCH /dishes/:id", "PATCH", "/dishes/abc", exists, true],
      ["DELETE /dishes/:id", "DELETE", "/dishes/abc", exists, true],
      ["Stock dans les plats", "GET", "/dishes?pageSize=1", (r) => r.json?.items?.[0] !== undefined && "stock" in r.json.items[0]],
    ],
  },
  {
    palier: 3,
    title: "Palier 3 — temps réel et photos",
    checks: [
      ["GET /events (SSE)", "STREAM", "/events", (r) => r.status === 200 && r.stream, true],
      ["PUT /dishes/:id/image", "PUT", "/dishes/abc/image", exists, true],
      ["imageUrl dans les plats", "GET", "/dishes?pageSize=1", (r) => r.json?.items?.[0] !== undefined && "imageUrl" in r.json.items[0]],
      ["/health vérifie la base", "GET", "/health", (r) => r.json?.database === "up"],
    ],
  },
  {
    palier: 4,
    title: "Palier 4 — paiement",
    checks: [["POST /orders/:id/payment", "POST", "/orders/abc/payment", exists, true]],
  },
];

async function probe(method, path, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (method === "LOGIN") {
    const res = await fetch(apiUrl() + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "client@roulotte.test", password: "Client123!" }) });
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  if (method === "STREAM") {
    const controller = new AbortController();
    const res = await fetch(apiUrl() + path, { headers, signal: controller.signal });
    const stream = (res.headers.get("content-type") ?? "").includes("text/event-stream");
    controller.abort(); // on a vu les en-têtes : on referme le flux
    return { status: res.status, json: null, stream };
  }
  const withBody = method !== "GET" && method !== "DELETE";
  const res = await fetch(apiUrl() + path, { method, headers: withBody ? { ...headers, "Content-Type": "application/json" } : headers, body: withBody ? "{}" : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
}

export function renderStatut(view) {
  const input = h("input", { type: "url", value: apiUrl(), placeholder: "http://localhost:3000" });
  const results = h("div");

  async function run() {
    results.replaceChildren(h("p", { class: "muted" }, "Analyse en cours…"));
    try {
      await fetch(`${apiUrl()}/health`);
    } catch {
      results.replaceChildren(
        h(
          "div",
          { class: "panel stack" },
          h("strong", { class: "ko" }, `Impossible de joindre ${apiUrl()}`),
          h("span", {}, "Causes possibles : l'API n'est pas démarrée, le port est différent, ou CORS n'autorise pas l'origine ", h("code", {}, location.origin), "."),
        ),
      );
      return;
    }
    const groups = [];
    let token = null;
    for (const group of PROBES) {
      const rows = [];
      let ok = 0;
      for (const [label, method, path, test, needsToken] of group.checks) {
        let r = { status: 0, json: null };
        if (!needsToken || token) {
          try {
            r = await probe(method, path, needsToken ? token : null);
          } catch {
            /* réseau ou CORS */
          }
        }
        if (method === "LOGIN" && r.status === 200) token = r.json?.token ?? null;
        const passed = test(r);
        if (passed) ok++;
        rows.push(h("tr", {}, h("td", {}, label), h("td", { class: "mono" }, r.status || "—"), h("td", { class: passed ? "ok" : "ko" }, passed ? "✓ détecté" : r.status === 404 ? "✗ absent" : needsToken && !token ? "✗ connexion impossible" : "✗ non conforme")));
      }
      groups.push(
        h(
          "div",
          { class: "panel probe-group" },
          h("h3", {}, group.title, h("span", { class: `badge ${ok === group.checks.length ? "good" : ok ? "warn" : ""}` }, `${ok} / ${group.checks.length}`)),
          h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Vérification"), h("th", {}, "Statut HTTP"), h("th", {}, "Résultat"))), h("tbody", {}, rows)),
        ),
      );
    }
    results.replaceChildren(
      h("p", { class: "hint" }, "Détection rapide avec le compte client du seed : elle vérifie que les routes existent. La recette du kit (npm run recette:N) vérifie leur comportement."),
      ...groups,
    );
  }

  view.replaceChildren(
    h("div", { class: "page-head" }, h("div", {}, h("div", { class: "eyebrow" }, "Outils"), h("h1", {}, "Statut de l'API"), h("p", {}, "Le front parle à votre API ; vérifiez ici ce qu'elle sait déjà faire."))),
    h(
      "form",
      {
        class: "panel row",
        onsubmit: (e) => {
          e.preventDefault();
          setApiUrl(input.value.trim());
          input.value = apiUrl();
          run();
        },
      },
      h("label", { style: "flex:1" }, "Adresse de l'API", input),
      h("button", { class: "btn primary", style: "align-self:end" }, "Enregistrer et tester"),
    ),
    results,
  );
  run();
}
