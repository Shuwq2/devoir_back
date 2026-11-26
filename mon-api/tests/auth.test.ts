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

describe("Authentification", () => {
  it("inscrit un client puis le connecte", async () => {
    const email = `test-${Date.now()}@example.test`;
    const registration = await api.request("POST", "/auth/register", {
      email,
      name: "Client de test",
      password: "motdepasse123",
    });
    const registeredUser = registration.body as {
      id: number;
      email: string;
      role: string;
    };

    assert.equal(registration.status, 201, "L’inscription doit répondre 201.");
    assert.equal(registeredUser.email, email);
    assert.equal(registeredUser.role, "CUSTOMER");
    assert.equal(registration.headers.get("location"), `/users/${registeredUser.id}`);

    const login = await api.request("POST", "/auth/login", {
      email: email.toUpperCase(),
      password: "motdepasse123",
    });
    const loggedInUser = login.body as {
      token: string;
      user: { id: number; email: string; role: string };
    };

    assert.equal(login.status, 200, "La connexion doit répondre 200.");
    assert.ok(loggedInUser.token, "La réponse doit contenir un jeton.");
    assert.equal(loggedInUser.user.id, registeredUser.id);
    assert.equal(loggedInUser.user.email, email);
  });
});
