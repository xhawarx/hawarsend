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
import { createAdminRoute, ADMIN_COOKIE, resetAdminState } from "../src/routes/admin.js";
import { createPasswordLockout } from "../src/lib/password-lockout.js";
import { resetRuntimeSettings } from "../src/lib/runtime-settings.js";
import { validateUploadSize } from "../src/lib/upload-validation.js";

const PASSWORD = "correct horse battery staple";

const GB = 1024 ** 3;

let CONFIG: Config;
const BASE_CONFIG = {
  ADMIN_PASSWORD: PASSWORD,
  ADMIN_SESSION_DURATION: 3600,
  BASE_URL: "http://localhost:3000",
  TRUST_PROXY: false,
  CUSTOM_TITLE: "HawarSend",
  ENABLED_SERVICES: ["file", "note", "request"],
  FILE_MAX_SIZE: 2 * GB,
  FILE_REQUEST_MAX_SIZE: 2 * GB,
  FILE_UPLOAD_QUOTA_BYTES: 0,
  FILE_MAX_FILES_PER_UPLOAD: 200,
};

describe("admin route", () => {
  let dbCtx: ReturnType<typeof createTestDb>;
  let storageCtx: Awaited<ReturnType<typeof createTestStorage>>;
  let app: Hono;

  beforeEach(async () => {
    dbCtx = createTestDb();
    storageCtx = await createTestStorage();
    vi.mocked(getDb).mockReturnValue(dbCtx.db);
    // A fresh copy for each test, since the limits change the cached config in place.
    CONFIG = { ...BASE_CONFIG } as unknown as Config;
    vi.mocked(getConfig).mockReturnValue(CONFIG);
    resetAdminState();
    resetRuntimeSettings();
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
  it("ends the session on the server at logout, even for a copied cookie", async () => {
    const cookie = await sessionCookie();
    const logout = await app.request("/api/admin/logout", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(logout.status).toBe(200);
    const after = await app.request("/api/admin/stats", { headers: { Cookie: cookie } });
    expect(after.status).toBe(401);
  });

  it("refuses an oversized login body", async () => {
    const res = await app.request("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "x".repeat(64 * 1024) }),
    });
    expect(res.status).toBe(413);
  });

  it("stops every login after too many failures from many addresses", async () => {
    const wide = new Hono();
    // A lockout that never triggers per client, so only the global ceiling is left.
    wide.route(
      "/api/admin",
      createAdminRoute({ storage: storageCtx.storage, lockout: createPasswordLockout(10_000, 60_000) }),
    );
    for (let i = 0; i < 30; i++) {
      const res = await wide.request("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: `guess-${i}-guess` }),
      });
      expect(res.status).toBe(401);
    }
    const right = await wide.request("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(right.status).toBe(429);
  });

  it("hides the admin API from addresses outside ADMIN_ALLOWED_IPS", async () => {
    vi.mocked(getConfig).mockReturnValue({ ...CONFIG, ADMIN_ALLOWED_IPS: ["203.0.113.0/24"] } as Config);
    const limited = new Hono();
    limited.route(
      "/api/admin",
      createAdminRoute({ storage: storageCtx.storage, lockout: createPasswordLockout(3, 60_000) }),
    );
    const res = await limited.request("/api/admin/session");
    expect(res.status).toBe(404);
  });
  function putLimits(cookie: string, body: unknown) {
    return app.request("/api/admin/limits", {
      method: "PUT",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("refuses the limits without a session", async () => {
    const res = await app.request("/api/admin/limits", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ FILE_MAX_SIZE: "10GB" }),
    });
    expect(res.status).toBe(401);
  });

  it("raises the upload limit to 1 TB at once and keeps it in the database", async () => {
    const cookie = await sessionCookie();
    const res = await putLimits(cookie, { FILE_MAX_SIZE: "1TB" });
    expect(res.status).toBe(200);
    expect(CONFIG.FILE_MAX_SIZE).toBe(1024 * GB);
    expect(CONFIG.FILE_REQUEST_MAX_SIZE).toBe(1024 * GB);
    // The next upload is checked against the new limit.
    expect(validateUploadSize(500 * GB, 1, CONFIG)).toBeNull();
    const row = dbCtx.sqlite.prepare("select value from settings where key = 'FILE_MAX_SIZE'").get() as
      | { value: string }
      | undefined;
    expect(row?.value).toBe(String(1024 * GB));
  });

  it("goes back to the environment value with null", async () => {
    const cookie = await sessionCookie();
    await putLimits(cookie, { FILE_MAX_SIZE: "10GB" });
    expect(CONFIG.FILE_MAX_SIZE).toBe(10 * GB);
    const res = await putLimits(cookie, { FILE_MAX_SIZE: null });
    expect(res.status).toBe(200);
    expect(CONFIG.FILE_MAX_SIZE).toBe(2 * GB);
    const body = (await res.json()) as { limits: { key: string; overridden: boolean }[] };
    expect(body.limits.find((l) => l.key === "FILE_MAX_SIZE")?.overridden).toBe(false);
  });

  it("refuses an invalid or out of range value and changes nothing", async () => {
    const cookie = await sessionCookie();
    for (const body of [
      { FILE_MAX_SIZE: "lots" },
      { FILE_MAX_SIZE: "500TB" },
      { FILE_MAX_SIZE: "10GB", FILE_MAX_FILES_PER_UPLOAD: 0 },
      { UNKNOWN_SETTING: 1 },
      ["FILE_MAX_SIZE"],
    ]) {
      expect((await putLimits(cookie, body)).status).toBe(400);
    }
    expect(CONFIG.FILE_MAX_SIZE).toBe(2 * GB);
    expect(CONFIG.FILE_MAX_FILES_PER_UPLOAD).toBe(200);
  });
});
