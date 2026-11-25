// Serveur statique du front (aucune dépendance). Lancement : npm run front → http://localhost:5173
// NE PAS MODIFIER le front : votre API doit fonctionner avec lui tel quel.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 5173);
const root = path.dirname(fileURLToPath(import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root) || file.endsWith(".mjs")) file = path.join(root, "index.html");
  try {
    let body;
    try {
      body = await readFile(file);
    } catch {
      file = path.join(root, "index.html");
      body = await readFile(file);
    }
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(500).end("Erreur du serveur du front");
  }
}).listen(PORT, () => {
  console.log(`Front de La Roulotte : http://localhost:${PORT}`);
  console.log("API attendue par défaut sur http://localhost:3000 (modifiable dans la page « Statut de l'API »)");
});
