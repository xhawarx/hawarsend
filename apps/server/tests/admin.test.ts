import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createTestDb, createTestStorage, insertTestUpload, TEST_UUID } from "./helpers.js";
import { uploads } from "../src/db/schema.js";
import type { Config } from "../src/lib/config.js";

vi.mock("../src/db/index.js", () => ({ getDb: vi.fn() }));
vi.mock("../src/lib/config.js", () => ({ getConfig: vi.fn() }));

import { getDb } from "../src/db/index.js";
import { getConfig } from "../src/lib/config.js";
import { createAdminRoute, ADMIN_COOKIE } from "../src/routes/admin.js";
import { createPasswordLockout } from "../src/lib/password-lockout.js";

const PASSWORD = "correct horse battery staple";

const CONFIG = {
  ADMIN_PASSWORD: PASSWORD,
  ADMIN_SESSION_DURATION: 3600,
  BASE_URL: "http://localhost:3000",
  TRUST_PROXY: false,
  CUSTOM_TITLE: "HawarSend",
  ENABLED_SERVICES: ["file", "note", "request"],
} as unknown as Config;

describe("admin route", () => {
  let dbCtx: ReturnType<typeof createTestDb>;
  let storageCtx: Awaited<ReturnType<typeof createTestStorage>>;
  let app: Hono;

  beforeEach(async () => {
    dbCtx = createTestDb();
    storageCtx = await createTestStorage();
    vi.mocked(getDb).mockReturnValue(dbCtx.db);
    vi.mocked(getConfig).mockReturnValue(CONFIG);
    app = new Hono();
    app.route(
      "/api/admin",
      createAdminRoute({ storage: storageCtx.storage, lockout: createPasswordLockout(3, 60_000) }),
    );
  });

  afterEach(() => {
    dbCtx.cleanup();
    storageCtx.cleanup();
    vi.restoreAllMocks();
  });

  function login(password: string) {
    return app.request("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
  }

  async function sessionCookie(): Promise<string> {
    const res = await login(PASSWORD);
    expect(res.status).toBe(200);
    const header = res.headers.get("Set-Cookie") ?? "";
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Path=/api/admin");
    return header.split(";", 1)[0]!;
  }

  it("refuses the stats without a session", async () => {
    const res = await app.request("/api/admin/stats");
    expect(res.status).toBe(401);
  });

  it("refuses a forged session cookie", async () => {
    const res = await app.request("/api/admin/stats", {
      headers: { Cookie: `${ADMIN_COOKIE}=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.x` },
    });
    expect(res.status).toBe(401);
  });

  it("refuses a wrong password", async () => {
    const res = await login("wrong password!");
    expect(res.status).toBe(401);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("refuses a login body that is not JSON", async () => {
    const res = await app.request("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(res.status).toBe(415);
  });

  it("locks the login after too many wrong passwords", async () => {
    for (let i = 0; i < 3; i++) expect((await login("nope nope nope")).status).toBe(401);
    expect((await login(PASSWORD)).status).toBe(429);
  });

  it("reports stats and lists uploads without tokens", async () => {
    insertTestUpload(dbCtx.db, { size: 2048 });
    const cookie = await sessionCookie();

    const stats = await app.request("/api/admin/stats", { headers: { Cookie: cookie } });
    expect(stats.status).toBe(200);
    const body = (await stats.json()) as { uploads: { total: number }; storageBytes: number };
    expect(body.uploads.total).toBe(1);
    expect(body.storageBytes).toBe(2048);

    const list = await app.request("/api/admin/items/uploads", { headers: { Cookie: cookie } });
    expect(list.status).toBe(200);
    const text = await list.text();
    expect(text).toContain(TEST_UUID);
    expect(text).not.toContain("ownerToken");
    expect(text).not.toContain("authToken");
    expect(text).not.toContain("storagePath");
  });

  it("deletes an upload and refuses an invalid ID", async () => {
    insertTestUpload(dbCtx.db);
    const cookie = await sessionCookie();

    const bad = await app.request("/api/admin/items/uploads/../etc", {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(bad.status).not.toBe(200);

    const res = await app.request(`/api/admin/items/uploads/${TEST_UUID}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(dbCtx.db.select().from(uploads).where(eq(uploads.id, TEST_UUID)).get()).toBeUndefined();

    const again = await app.request(`/api/admin/items/uploads/${TEST_UUID}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(again.status).toBe(404);
  });

  it("does not hand out the admin password in the settings", async () => {
    const cookie = await sessionCookie();
    const res = await app.request("/api/admin/settings", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain(PASSWORD);
  });
});
