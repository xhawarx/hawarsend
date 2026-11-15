import { Hono, type Context } from "hono";
import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { and, desc, eq, gt, or, sql } from "drizzle-orm";
import { constantTimeEqual } from "@skysend/crypto";
import { getDb } from "../db/index.js";
import { uploads, notes, fileRequests, requestUploads } from "../db/schema.js";
import { getConfig } from "../lib/config.js";
import { deleteFileRequest, runCleanup } from "../lib/cleanup.js";
import { lockedResponse, type PasswordLockout } from "../lib/password-lockout.js";
import { getClientIp } from "../middleware/rate-limit.js";
import { requireJson } from "../middleware/require-json.js";
import type { StorageBackend } from "../storage/types.js";

/**
 * The web admin panel API, mounted at /api/admin while ADMIN_PASSWORD is set.
 *
 * It only reads and deletes what the server stores anyway: IDs, sizes, counters and times.
 * No key, filename or note content ever reaches the server, so none can be shown here.
 *
 * The session is an HS256 JWT in an HttpOnly cookie scoped to /api/admin with SameSite=Strict.
 * Its signing key lives in memory only, so a restart signs every admin out.
 */

export const ADMIN_COOKIE = "hawarsend-admin";
const LOCKOUT_KEY = "admin-login";
const PAGE_SIZE = 50;
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

const signingKey = randomBytes(32);

const loginSchema = z.object({ password: z.string().min(1).max(512) });
const kindSchema = z.enum(["uploads", "notes", "requests"]);
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(0).max(100000).default(0),
});

function digest(value: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(value, "utf8").digest());
}

function cookieAttributes(maxAgeSec: number): string {
  const parts = [`Max-Age=${maxAgeSec}`, "Path=/api/admin", "HttpOnly", "SameSite=Strict"];
  if (getConfig().BASE_URL.startsWith("https://")) parts.push("Secure");
  return parts.join("; ");
}

async function isAdmin(c: Context): Promise<boolean> {
  const token = getCookie(c, ADMIN_COOKIE);
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, signingKey, { algorithms: ["HS256"] });
    return payload["sub"] === "admin";
  } catch {
    return false;
  }
}

const requireAdmin = createMiddleware(async (c, next) => {
  if (!(await isAdmin(c))) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

function countStats() {
  const db = getDb();
  const now = new Date();
  const uploadTotal = db
    .select({
      count: sql<number>`count(*)`,
      size: sql<number>`coalesce(sum(${uploads.size}), 0)`,
      downloads: sql<number>`coalesce(sum(${uploads.downloadCount}), 0)`,
    })
    .from(uploads)
    .get()!;
  const uploadActive = db
    .select({ count: sql<number>`count(*)`, size: sql<number>`coalesce(sum(${uploads.size}), 0)` })
    .from(uploads)
    .where(and(gt(uploads.expiresAt, now), sql`${uploads.downloadCount} < ${uploads.maxDownloads}`))
    .get()!;
  const noteTotal = db
    .select({
      count: sql<number>`count(*)`,
      views: sql<number>`coalesce(sum(${notes.viewCount}), 0)`,
    })
    .from(notes)
    .get()!;
  const noteActive = db
    .select({ count: sql<number>`count(*)` })
    .from(notes)
    .where(
      and(
        gt(notes.expiresAt, now),
        or(sql`${notes.maxViews} = 0`, sql`${notes.viewCount} < ${notes.maxViews}`),
      ),
    )
    .get()!;
  const requestTotal = db.select({ count: sql<number>`count(*)` }).from(fileRequests).get()!;
  const requestOpen = db
    .select({ count: sql<number>`count(*)` })
    .from(fileRequests)
    .where(and(sql`${fileRequests.closed} = 0`, gt(fileRequests.closesAt, now)))
    .get()!;
  const kept = db
    .select({
      count: sql<number>`count(*)`,
      size: sql<number>`coalesce(sum(${requestUploads.size}), 0)`,
    })
    .from(requestUploads)
    .get()!;

  return {
    uploads: {
      total: uploadTotal.count,
      active: uploadActive.count,
      size: uploadTotal.size,
      activeSize: uploadActive.size,
      downloads: uploadTotal.downloads,
    },
    notes: { total: noteTotal.count, active: noteActive.count, views: noteTotal.views },
    requests: {
      total: requestTotal.count,
      open: requestOpen.count,
      uploads: kept.count,
      size: kept.size,
    },
    storageBytes: uploadTotal.size + kept.size,
  };
}

function settingsSummary() {
  const config = getConfig();
  return {
    title: config.CUSTOM_TITLE,
    baseUrl: config.BASE_URL,
    enabledServices: config.ENABLED_SERVICES,
    storageBackend: config.STORAGE_BACKEND,
    fileMaxSize: config.FILE_MAX_SIZE,
    fileMaxFilesPerUpload: config.FILE_MAX_FILES_PER_UPLOAD,
    fileExpireOptions: config.FILE_EXPIRE_OPTIONS_SEC,
    fileDownloadOptions: config.FILE_DOWNLOAD_OPTIONS,
    fileUploadQuotaBytes: config.FILE_UPLOAD_QUOTA_BYTES,
    noteMaxSize: config.NOTE_MAX_SIZE,
    noteExpireOptions: config.NOTE_EXPIRE_OPTIONS_SEC,
    forceFilePassword: config.FORCE_FILE_PASSWORD,
    forceNotePassword: config.FORCE_NOTE_PASSWORD,
    passwordMaxAttempts: config.PASSWORD_MAX_ATTEMPTS,
    passwordLockoutMs: config.PASSWORD_LOCKOUT_MS,
    rateLimitMax: config.RATE_LIMIT_MAX,
    rateLimitWindow: config.RATE_LIMIT_WINDOW,
    trustProxy: config.TRUST_PROXY,
    oidcEnabled: config.OIDC_ENABLED,
    defaultTheme: config.DEFAULT_THEME,
    defaultColorScheme: config.DEFAULT_COLOR_SCHEME,
    customColor: config.CUSTOM_COLOR ?? null,
  };
}

function listItems(kind: z.infer<typeof kindSchema>, page: number) {
  const db = getDb();
  const offset = page * PAGE_SIZE;
  if (kind === "uploads") {
    return db
      .select({
        id: uploads.id,
        size: uploads.size,
        fileCount: uploads.fileCount,
        hasPassword: uploads.hasPassword,
        downloadCount: uploads.downloadCount,
        maxDownloads: uploads.maxDownloads,
        expiresAt: uploads.expiresAt,
        createdAt: uploads.createdAt,
      })
      .from(uploads)
      .orderBy(desc(uploads.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset)
      .all();
  }
  if (kind === "notes") {
    return db
      .select({
        id: notes.id,
        size: sql<number>`length(${notes.encryptedContent})`,
        hasPassword: notes.hasPassword,
        viewCount: notes.viewCount,
        maxViews: notes.maxViews,
        expiresAt: notes.expiresAt,
        createdAt: notes.createdAt,
      })
      .from(notes)
      .orderBy(desc(notes.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset)
      .all();
  }
  return db
    .select({
      id: fileRequests.id,
      size: fileRequests.finishedBytes,
      hasPassword: fileRequests.hasPassword,
      finishedUploads: fileRequests.finishedUploads,
      maxUploads: fileRequests.maxUploads,
      closed: fileRequests.closed,
      expiresAt: fileRequests.closesAt,
      createdAt: fileRequests.createdAt,
    })
    .from(fileRequests)
    .orderBy(desc(fileRequests.createdAt))
    .limit(PAGE_SIZE)
    .offset(offset)
    .all();
}

async function deleteItem(
  storage: StorageBackend,
  kind: z.infer<typeof kindSchema>,
  id: string,
): Promise<boolean> {
  const db = getDb();
  if (kind === "uploads") {
    const result = db.delete(uploads).where(eq(uploads.id, id)).run();
    if (result.changes === 0) return false;
    await storage.delete(id);
    return true;
  }
  if (kind === "notes") {
    return db.delete(notes).where(eq(notes.id, id)).run().changes > 0;
  }
  return deleteFileRequest(storage, id);
}

export function createAdminRoute(options: { storage: StorageBackend; lockout: PasswordLockout }) {
  const { storage, lockout } = options;
  const route = new Hono();

  route.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  route.get("/session", async (c) => c.json({ authenticated: await isAdmin(c) }));

  route.post("/login", requireJson, async (c) => {
    const config = getConfig();
    const ip = getClientIp(c, config.TRUST_PROXY);
    const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid request" }, 400);

    // Checked again after the last await, so parallel guesses cannot pass together.
    const locked = lockedResponse(c, lockout, LOCKOUT_KEY, ip);
    if (locked) return locked;

    const expected = digest(config.ADMIN_PASSWORD ?? "");
    if (!config.ADMIN_PASSWORD || !constantTimeEqual(digest(parsed.data.password), expected)) {
      lockout.recordFailure(LOCKOUT_KEY, ip);
      return c.json({ error: "Wrong password" }, 401);
    }
    lockout.recordSuccess(LOCKOUT_KEY, ip);

    const duration = config.ADMIN_SESSION_DURATION;
    const token = await new SignJWT({ sub: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${duration}s`)
      .sign(signingKey);
    c.header("Set-Cookie", `${ADMIN_COOKIE}=${token}; ${cookieAttributes(duration)}`);
    return c.json({ ok: true });
  });

  route.post("/logout", (c) => {
    c.header("Set-Cookie", `${ADMIN_COOKIE}=; ${cookieAttributes(0)}`);
    return c.json({ ok: true });
  });

  route.use("/stats", requireAdmin);
  route.use("/settings", requireAdmin);
  route.use("/items/*", requireAdmin);
  route.use("/cleanup", requireAdmin);

  route.get("/stats", (c) => c.json(countStats()));
  route.get("/settings", (c) => c.json(settingsSummary()));

  route.get("/items/:kind", (c) => {
    const kind = kindSchema.safeParse(c.req.param("kind"));
    const query = listQuerySchema.safeParse(c.req.query());
    if (!kind.success || !query.success) return c.json({ error: "Invalid request" }, 400);
    const items = listItems(kind.data, query.data.page).map((item) => ({
      ...item,
      expiresAt: item.expiresAt.getTime(),
      createdAt: item.createdAt.getTime(),
    }));
    return c.json({ items, page: query.data.page, pageSize: PAGE_SIZE });
  });

  route.delete("/items/:kind/:id", async (c) => {
    const kind = kindSchema.safeParse(c.req.param("kind"));
    const id = c.req.param("id");
    if (!kind.success || !UUID_RE.test(id)) return c.json({ error: "Invalid request" }, 400);
    const deleted = await deleteItem(storage, kind.data, id);
    return deleted ? c.json({ ok: true }) : c.json({ error: "Not found" }, 404);
  });

  route.post("/cleanup", requireJson, async (c) => {
    const removed = await runCleanup(storage);
    return c.json({ removed });
  });

  return route;
}
