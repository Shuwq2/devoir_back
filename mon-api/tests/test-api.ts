import { once } from "node:events";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type TestApi = {
  request(method: string, path: string, body?: unknown, token?: string): Promise<{
    status: number;
    headers: Headers;
    body: unknown;
  }>;
  close(): Promise<void>;
};

export async function startTestApi(): Promise<TestApi> {
  const directory = await mkdtemp(join(tmpdir(), "mon-api-tests-"));
  const portProbe = createServer();
  portProbe.listen(0, "127.0.0.1");
  await once(portProbe, "listening");
  const port = (portProbe.address() as AddressInfo).port;
  await new Promise<void>((resolveClose) => portProbe.close(() => resolveClose()));

  const env = {
    ...process.env,
    DATABASE_URL: `file:${join(directory, "test.db")}`,
    JWT_SECRET: "integration-test-secret-long-enough",
    PORT: String(port),
  };
  const prisma = join(apiDirectory, "node_modules", ".bin", "prisma");
  const tsx = join(apiDirectory, "node_modules", ".bin", "tsx");
  execFileSync(prisma, ["migrate", "deploy"], { cwd: apiDirectory, env, stdio: "ignore" });
  execFileSync(tsx, ["prisma/seed.js"], { cwd: apiDirectory, env, stdio: "ignore" });

  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", "app.js"], {
    cwd: apiDirectory,
    env,
    stdio: "ignore",
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      ready = (await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(200) })).ok;
      if (ready) break;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
  }
  if (!ready) {
    child.kill("SIGTERM");
    await once(child, "exit");
    await rm(directory, { recursive: true, force: true });
    throw new Error("L’API de test n’a pas démarré.");
  }

  return {
    async request(method: string, path: string, body?: unknown, token?: string) {
      const headers = new Headers();
      if (body !== undefined) headers.set("content-type", "application/json");
      if (token) headers.set("authorization", `Bearer ${token}`);
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return {
        status: response.status,
        headers: response.headers,
        body: text ? JSON.parse(text) as unknown : undefined,
      };
    },
    async close() {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await once(child, "exit");
      }
      await rm(directory, { recursive: true, force: true });
    },
  };
}
