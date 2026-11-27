import { currentUser } from "../fourni/auth/index.ts";
import { toOrderDto } from "../dto/order.dto.js";

export function createEventsController(eventHub) {
  return (req, res) => {
    const user = currentUser(req);
    res.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const unsubscribe = eventHub.subscribe(user, (event, order) => {
      if (!res.writableEnded) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(toOrderDto(order))}\n\n`);
      }
    });
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(": ping\n\n");
    }, 25_000);
    heartbeat.unref();
    const close = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    res.on("close", close);
    res.flushHeaders();
  };
}
