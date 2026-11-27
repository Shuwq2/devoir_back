import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startTestApi } from "./test-api.ts";

let api: Awaited<ReturnType<typeof startTestApi>>;

before(async () => {
  api = await startTestApi();
});

after(async () => {
  await api?.close();
});

async function login(email: string, password: string) {
  const response = await api.request("POST", "/auth/login", { email, password });
  assert.equal(response.status, 200);
  return (response.body as { token: string }).token;
}

async function openStream(token: string) {
  const controller = new AbortController();
  const response = await fetch(`${api.baseUrl}/events`, {
    headers: {
      authorization: `Bearer ${token}`,
      origin: "http://localhost:5173",
    },
    signal: controller.signal,
  });
  const events: Array<{ type: string; data: { id: number; status: string; items?: unknown[] } }> = [];
  let streamError: Error | undefined;
  assert.ok(response.body);
  const reader = response.body.getReader();
  const reading = async () => {
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += new TextDecoder().decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        let type = "message";
        const data: string[] = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) type = line.slice(6).trim();
          if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        if (data.length > 0) events.push({ type, data: JSON.parse(data.join("\n")) });
      }
    }
  };
  void reading().catch((error: unknown) => {
    if (!controller.signal.aborted) {
      streamError = error instanceof Error ? error : new Error(String(error));
    }
  });
  return { response, events, get error() { return streamError; }, close: () => controller.abort() };
}

async function waitForEvent(
  stream: Awaited<ReturnType<typeof openStream>>,
  predicate: (event: (typeof stream.events)[number]) => boolean,
) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (stream.error) throw stream.error;
    const event = stream.events.find(predicate);
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Événement SSE non reçu : ${JSON.stringify(stream.events.map(({ type }) => type))}`);
}

describe("Flux d’événements des commandes", () => {
  it("authentifie le flux et filtre les événements par rôle et propriétaire", async () => {
    const sansJeton = await fetch(`${api.baseUrl}/events`);
    assert.equal(sansJeton.status, 401);

    const staffToken = await login("cuisine@roulotte.test", "Cuisine123!");
    const aliceToken = await login("client@roulotte.test", "Client123!");
    const email = `events-${Date.now()}@example.test`;
    const registration = await api.request("POST", "/auth/register", {
      email,
      name: "Autre client",
      password: "motdepasse123",
    });
    assert.equal(registration.status, 201);
    const bobToken = await login(email, "motdepasse123");

    const staff = await openStream(staffToken);
    const alice = await openStream(aliceToken);
    const bob = await openStream(bobToken);
    try {
      assert.equal(staff.response.status, 200);
      assert.ok(staff.response.headers.get("content-type")?.startsWith("text/event-stream"));
      assert.equal(staff.response.headers.get("access-control-allow-origin"), "http://localhost:5173");

      const dishes = await api.request("GET", "/dishes?pageSize=50");
      const fries = (dishes.body as { items: Array<{ id: number; name: string }> }).items
        .find(({ name }) => name === "Frites maison");
      assert.ok(fries);
      const creation = await api.request("POST", "/orders", {
        items: [{ dishId: fries.id, quantity: 1 }],
      }, aliceToken);
      assert.equal(creation.status, 201);
      const orderId = (creation.body as { id: number }).id;

      const created = await waitForEvent(staff, (event) =>
        event.type === "order.created" && event.data.id === orderId);
      assert.equal(created.data.status, "RECEIVED");
      assert.ok(Array.isArray(created.data.items));

      const updatedResponse = await api.request(
        "PATCH",
        `/orders/${orderId}/status`,
        { status: "PREPARING" },
        staffToken,
      );
      assert.equal(updatedResponse.status, 200);
      const aliceUpdate = await waitForEvent(alice, (event) =>
        event.type === "order.updated" && event.data.id === orderId);
      assert.equal(aliceUpdate.data.status, "PREPARING");
      await waitForEvent(staff, (event) =>
        event.type === "order.updated" && event.data.id === orderId);

      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.ok(!bob.events.some((event) => event.data.id === orderId));
      assert.ok(!alice.events.some((event) => event.type === "order.created"));
    } finally {
      staff.close();
      alice.close();
      bob.close();
    }
  });
});
