// Connexion et inscription.
import { api, session } from "../api.js";
import { h, showError, toast } from "../ui.js";

// Comptes du seed (donnees/menu.json)
const DEMO = [
  { label: "Client", email: "client@roulotte.test", password: "Client123!" },
  { label: "Cuisine", email: "cuisine@roulotte.test", password: "Cuisine123!" },
  { label: "Admin", email: "admin@roulotte.test", password: "Admin123!" },
];

let mode = "login";

export function renderConnexion(view) {
  const errors = h("div", { class: "stack" });
  const email = h("input", { type: "email", name: "email", required: true, autocomplete: "username" });
  const password = h("input", { type: "password", name: "password", required: true, autocomplete: mode === "login" ? "current-password" : "new-password" });
  const name = h("input", { type: "text", name: "name", required: true, autocomplete: "name" });
  const submit = h("button", { class: "btn primary block" }, mode === "login" ? "Se connecter" : "Créer mon compte");

  const form = h(
    "form",
    { class: "stack", onsubmit: (e) => (e.preventDefault(), send()) },
    mode === "register" ? h("label", {}, "Prénom et nom", name) : null,
    h("label", {}, "Email", email),
    h("label", {}, "Mot de passe", password, mode === "register" ? h("span", { class: "hint" }, "8 caractères minimum") : null),
    errors,
    submit,
  );

  async function send() {
    submit.disabled = true;
    errors.replaceChildren();
    try {
      if (mode === "register") {
        await api.post("/auth/register", { email: email.value, name: name.value, password: password.value }, { auth: false });
        toast("Compte créé, bienvenue !", { type: "success" });
      }
      await login(email.value, password.value);
    } catch (err) {
      if (err.code === "VALIDATION_ERROR" && Array.isArray(err.details)) {
        errors.replaceChildren(...err.details.map((d) => h("div", { class: "field-error" }, `${d.path || "Formulaire"} : ${d.message}`)));
      } else showError(err);
      submit.disabled = false;
    }
  }

  view.replaceChildren(
    h(
      "div",
      { class: "narrow stack" },
      h("div", { class: "page-head" }, h("div", {}, h("div", { class: "eyebrow" }, "Mon compte"), h("h1", {}, mode === "login" ? "Connexion" : "Inscription"))),
      h(
        "div",
        { class: "panel stack" },
        h(
          "div",
          { class: "tabs" },
          h("button", { class: `tab ${mode === "login" ? "active" : ""}`, onclick: () => ((mode = "login"), renderConnexion(view)) }, "J'ai un compte"),
          h("button", { class: `tab ${mode === "register" ? "active" : ""}`, onclick: () => ((mode = "register"), renderConnexion(view)) }, "Je crée un compte"),
        ),
        form,
      ),
      h(
        "div",
        { class: "panel stack" },
        h("strong", {}, "Comptes de démonstration (seed)"),
        h(
          "div",
          { class: "demo-accounts" },
          DEMO.map((d) => h("button", { type: "button", onclick: () => login(d.email, d.password).catch(showError) }, d.label, h("small", {}, d.email))),
        ),
      ),
    ),
  );
}

async function login(email, password) {
  const { token, user } = await api.post("/auth/login", { email, password }, { auth: false });
  if (!token || !user) throw Object.assign(new Error("Réponse de /auth/login hors contrat : { token, user } attendu"), { code: "FORMAT" });
  session.save(token, user);
  toast(`Bonjour ${user.name} !`, { type: "success" });
  location.hash = user.role === "STAFF" ? "#/cuisine" : user.role === "ADMIN" ? "#/admin" : "#/";
}
