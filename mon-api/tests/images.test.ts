import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startTestApi } from "./test-api.ts";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

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

async function createDish(token: string) {
  const categories = await api.request("GET", "/categories");
  const categoryId = (categories.body as Array<{ id: number }>)[0].id;
  const response = await api.request("POST", "/dishes", {
    name: `Image test ${Date.now()} ${Math.random()}`,
    priceCents: 500,
    categoryId,
  }, token);
  assert.equal(response.status, 201);
  return (response.body as { id: number }).id;
}

function formWithImage(buffer: Buffer, filename = "image.png", type = "image/png") {
  const form = new FormData();
  form.append("image", new Blob([buffer], { type }), filename);
  return form;
}

async function upload(token: string, id: number, form: FormData) {
  const response = await fetch(`${api.baseUrl}/dishes/${id}/image`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) as { imageUrl?: string; error?: { code: string } } : undefined,
  };
}

describe("Photos des plats", () => {
  it("réserve l’upload à l’admin, vérifie les octets et sert l’image au front", async () => {
    const admin = await login("admin@roulotte.test", "Admin123!");
    const staff = await login("cuisine@roulotte.test", "Cuisine123!");
    const dishId = await createDish(admin);

    const unauthenticated = await upload("", dishId, formWithImage(png));
    assert.equal(unauthenticated.status, 401);
    assert.equal((await upload(staff, dishId, formWithImage(png))).status, 403);

    const invalid = await upload(admin, dishId, formWithImage(Buffer.from("not an image")));
    assert.equal(invalid.status, 415);
    assert.equal(invalid.body?.error?.code, "UNSUPPORTED_MEDIA_TYPE");

    const uploaded = await upload(admin, dishId, formWithImage(png));
    assert.equal(uploaded.status, 200);
    assert.match(uploaded.body?.imageUrl ?? "", /^\/uploads\/dishes\//);
    const dish = await api.request("GET", `/dishes/${dishId}`);
    assert.equal((dish.body as { imageUrl: string }).imageUrl, uploaded.body?.imageUrl);

    const imageResponse = await fetch(`${api.baseUrl}${uploaded.body?.imageUrl}`);
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get("content-type"), "image/png");
    assert.equal(imageResponse.headers.get("cross-origin-resource-policy"), "cross-origin");
    assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), png);

    const missingDish = await upload(admin, 999999, formWithImage(png));
    assert.equal(missingDish.status, 404);
  });

  it("remplace l’ancienne image et applique la taille maximale de 2 Mo", async () => {
    const admin = await login("admin@roulotte.test", "Admin123!");
    const dishId = await createDish(admin);
    const first = await upload(admin, dishId, formWithImage(png, "first.png"));
    assert.equal(first.status, 200);
    const second = await upload(admin, dishId, formWithImage(png, "second.png"));
    assert.equal(second.status, 200);
    assert.notEqual(first.body?.imageUrl, second.body?.imageUrl);
    assert.equal((await fetch(`${api.baseUrl}${first.body?.imageUrl}`)).status, 404);

    const oversized = Buffer.concat([png, Buffer.alloc(2.5 * 1024 * 1024)]);
    const largeResponse = await upload(admin, dishId, formWithImage(oversized, "large.png"));
    assert.equal(largeResponse.status, 413);
    assert.equal(largeResponse.body?.error?.code, "PAYLOAD_TOO_LARGE");

    const missingFile = await upload(admin, dishId, new FormData());
    assert.equal(missingFile.status, 400);
    assert.equal(missingFile.body?.error?.code, "VALIDATION_ERROR");
  });
});
