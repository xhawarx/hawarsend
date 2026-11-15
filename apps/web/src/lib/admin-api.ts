/**
 * Client of the admin panel API at /api/admin. The session is an HttpOnly cookie the server
 * sets, so nothing here stores a token. Every response goes through a Zod schema.
 *
 * The admin API only knows what the server stores anyway: IDs, sizes, counters and times.
 */
import { z } from "zod";
import { ApiError } from "@skysend/transfer";

export type AdminKind = "uploads" | "notes" | "requests";

const sessionSchema = z.object({ authenticated: z.boolean() });

const statsSchema = z.object({
  uploads: z.object({
    total: z.number(),
    active: z.number(),
    size: z.number(),
    activeSize: z.number(),
    downloads: z.number(),
  }),
  notes: z.object({ total: z.number(), active: z.number(), views: z.number() }),
  requests: z.object({
    total: z.number(),
    open: z.number(),
    uploads: z.number(),
    size: z.number(),
  }),
  storageBytes: z.number(),
});
export type AdminStats = z.infer<typeof statsSchema>;

const settingsSchema = z.record(z.string(), z.unknown());
export type AdminSettings = z.infer<typeof settingsSchema>;

const itemSchema = z.object({
  id: z.string(),
  size: z.number(),
  hasPassword: z.boolean(),
  expiresAt: z.number(),
  createdAt: z.number(),
  fileCount: z.number().optional(),
  downloadCount: z.number().optional(),
  maxDownloads: z.number().optional(),
  viewCount: z.number().optional(),
  maxViews: z.number().optional(),
  finishedUploads: z.number().optional(),
  maxUploads: z.number().optional(),
  closed: z.boolean().optional(),
});
export type AdminItem = z.infer<typeof itemSchema>;

const itemsSchema = z.object({
  items: z.array(itemSchema),
  page: z.number(),
  pageSize: z.number(),
});

const okSchema = z.object({ ok: z.literal(true) });
const cleanupSchema = z.object({ removed: z.number() });

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    credentials: "same-origin",
    ...init,
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) throw new ApiError(res.status, `Admin request failed (${res.status})`);
  return schema.parse(await res.json());
}

/** False when the panel is off (no ADMIN_PASSWORD), which the server answers with a 404. */
export async function fetchAdminSession(): Promise<{ enabled: boolean; authenticated: boolean }> {
  try {
    const { authenticated } = await request("/session", sessionSchema);
    return { enabled: true, authenticated };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return { enabled: false, authenticated: false };
    throw err;
  }
}

export const adminLogin = (password: string) =>
  request("/login", okSchema, { method: "POST", body: JSON.stringify({ password }) });

export const adminLogout = () =>
  request("/logout", okSchema, { method: "POST", body: "{}" });

export const fetchAdminStats = () => request("/stats", statsSchema);

export const fetchAdminSettings = () => request("/settings", settingsSchema);

export const fetchAdminItems = (kind: AdminKind, page: number) =>
  request(`/items/${kind}?page=${page}`, itemsSchema);

export const deleteAdminItem = (kind: AdminKind, id: string) =>
  request(`/items/${kind}/${encodeURIComponent(id)}`, okSchema, { method: "DELETE" });

export const runAdminCleanup = () =>
  request("/cleanup", cleanupSchema, { method: "POST", body: "{}" });
