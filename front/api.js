// Client HTTP de l'API. Le front ne fait AUCUNE hypothèse en dehors du contrat (contrat/openapi.yaml).
const DEFAULT_API = "http://localhost:3000";

export function apiUrl() {
  return (localStorage.getItem("roulotte.api") || DEFAULT_API).replace(/\/$/, "");
}

export function setApiUrl(url) {
  if (url) localStorage.setItem("roulotte.api", url.replace(/\/$/, ""));
  else localStorage.removeItem("roulotte.api");
}

// Session (token + utilisateur) gardée dans le navigateur
export const session = {
  get token() {
    return localStorage.getItem("roulotte.token");
  },
  get user() {
    try {
      return JSON.parse(localStorage.getItem("roulotte.user") || "null");
    } catch {
      return null;
    }
  },
  save(token, user) {
    localStorage.setItem("roulotte.token", token);
    localStorage.setItem("roulotte.user", JSON.stringify(user));
    window.dispatchEvent(new Event("session"));
  },
  clear() {
    localStorage.removeItem("roulotte.token");
    localStorage.removeItem("roulotte.user");
    window.dispatchEvent(new Event("session"));
  },
};

// Erreur de l'API, au format du contrat { error: { code, message, details } }
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function request(method, path, { body, form, auth = true } = {}) {
  const headers = {};
  if (auth && session.token) headers.Authorization = `Bearer ${session.token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(apiUrl() + path, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) });
  } catch {
    throw new ApiError(0, "NETWORK", `API injoignable sur ${apiUrl()} : est-elle démarrée ? CORS autorise-t-il ${location.origin} ?`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = data?.error;
    if (!err?.code || !err?.message) {
      throw new ApiError(res.status, "FORMAT", `Réponse ${res.status} hors contrat : { error: { code, message } } attendu`);
    }
    // Token expiré ou révoqué : on se déconnecte
    if (res.status === 401 && auth && session.token && path !== "/auth/login") session.clear();
    throw new ApiError(res.status, err.code, err.message, err.details);
  }
  return data;
}

export const api = {
  get: (path, opts) => request("GET", path, opts),
  post: (path, body, opts) => request("POST", path, { ...opts, body }),
  patch: (path, body, opts) => request("PATCH", path, { ...opts, body }),
  put: (path, form, opts) => request("PUT", path, { ...opts, form }),
  del: (path, opts) => request("DELETE", path, opts),
};

// URL d'une image renvoyée par l'API (chemin relatif à l'API)
export function assetUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : apiUrl() + path;
}
