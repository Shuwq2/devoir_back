// Mises à jour en direct : flux SSE de l'API (palier 3), sinon actualisation périodique.
// Le flux est lu avec fetch (et non EventSource) pour pouvoir envoyer l'en-tête Authorization.
import { apiUrl, session } from "./api.js";

export function subscribe({ onEvent, onPoll, onMode }) {
  let stopped = false;
  let controller;
  let pollTimer;
  let retryTimer;

  const startPolling = () => {
    if (pollTimer) return;
    onMode("polling");
    pollTimer = setInterval(() => !stopped && onPoll(), 5000);
  };
  const stopPolling = () => {
    clearInterval(pollTimer);
    pollTimer = undefined;
  };

  async function connect() {
    if (stopped || !session.token) return;
    controller = new AbortController();
    let res;
    try {
      res = await fetch(`${apiUrl()}/events`, { headers: { Authorization: `Bearer ${session.token}` }, signal: controller.signal });
    } catch {
      if (!stopped) retryLater();
      return;
    }
    if (!res.ok || !res.body || !res.headers.get("content-type")?.includes("text/event-stream")) {
      res.body?.cancel().catch(() => {});
      startPolling(); // palier 3 pas encore atteint : on se contente d'actualiser
      return;
    }
    stopPolling();
    onMode("sse");
    onPoll(); // rattrape ce qui a pu se passer avant la connexion
    try {
      const decoder = new TextDecoder();
      let buffer = "";
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          let type = "message";
          const data = [];
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) type = line.slice(6).trim();
            else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
          }
          if (!data.length) continue;
          try {
            onEvent(type, JSON.parse(data.join("\n")));
          } catch {
            /* données illisibles : ignorées */
          }
        }
      }
    } catch {
      /* flux coupé */
    }
    if (!stopped) retryLater();
  }

  function retryLater() {
    startPolling();
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, 4000);
  }

  connect();
  return () => {
    stopped = true;
    controller?.abort();
    stopPolling();
    clearTimeout(retryTimer);
  };
}
