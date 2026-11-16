import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { settings } from "../db/schema.js";
import { getConfig, type Config } from "./config.js";
import { parseByteSize } from "./byte-size.js";

/**
 * Limits an admin can change in the panel while the server runs.
 *
 * The value of a setting lives in the `settings` table and wins over its environment variable.
 * It is written into the cached config object, which every route reads on each request, so a
 * change applies to the next upload without a restart. Removing it brings the environment
 * value back.
 */

const KB = 1024;
const MB = KB * 1024;
const TB = MB * 1024 * 1024;

export type RuntimeSettingKey = "FILE_MAX_SIZE" | "FILE_UPLOAD_QUOTA_BYTES" | "FILE_MAX_FILES_PER_UPLOAD";

interface Definition {
  kind: "bytes" | "count";
  min: number;
  max: number;
}

const DEFINITIONS: Record<RuntimeSettingKey, Definition> = {
  // 1 MB up to 100 TB for one upload.
  FILE_MAX_SIZE: { kind: "bytes", min: MB, max: 100 * TB },
  // 0 turns the quota off. At most 1 PB per address and window.
  FILE_UPLOAD_QUOTA_BYTES: { kind: "bytes", min: 0, max: 1024 * TB },
  FILE_MAX_FILES_PER_UPLOAD: { kind: "count", min: 1, max: 10000 },
};

export const RUNTIME_SETTING_KEYS = Object.keys(DEFINITIONS) as RuntimeSettingKey[];

/** The values the environment gave, before any setting of the panel. */
let envDefaults: Record<RuntimeSettingKey, number> | null = null;
/** Whether FILE_REQUEST_MAX_SIZE came from the environment or follows FILE_MAX_SIZE. */
let requestMaxFollows = true;

function rememberDefaults(config: Config): Record<RuntimeSettingKey, number> {
  if (!envDefaults) {
    envDefaults = {
      FILE_MAX_SIZE: config.FILE_MAX_SIZE,
      FILE_UPLOAD_QUOTA_BYTES: config.FILE_UPLOAD_QUOTA_BYTES,
      FILE_MAX_FILES_PER_UPLOAD: config.FILE_MAX_FILES_PER_UPLOAD,
    };
    requestMaxFollows = !process.env.FILE_REQUEST_MAX_SIZE;
  }
  return envDefaults;
}

/**
 * The number a value of the panel stands for, or an error message. Byte sizes take a number of
 * bytes or a size like "10GB", "1.5TB" or "500 MB".
 */
export function parseSettingValue(key: RuntimeSettingKey, value: unknown): number | string {
  const def = DEFINITIONS[key];
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string" && value.trim() !== "") {
    const text = value.trim();
    if (/^\d+$/.test(text)) {
      n = Number(text);
    } else if (def.kind === "bytes") {
      try {
        n = parseByteSize(text);
      } catch {
        return "Use a size like 10GB, 1.5TB or 500MB";
      }
    } else {
      return "Use a whole number";
    }
  } else {
    return "A value is required";
  }
  if (!Number.isSafeInteger(n)) return "Use a whole number";
  if (n < def.min || n > def.max) return `Must be between ${def.min} and ${def.max}`;
  return n;
}

function apply(config: Config, key: RuntimeSettingKey, value: number): void {
  config[key] = value;
  if (key === "FILE_MAX_SIZE") {
    // A request upload can never be larger than a normal one.
    if (requestMaxFollows || config.FILE_REQUEST_MAX_SIZE > value) {
      config.FILE_REQUEST_MAX_SIZE = value;
    }
  }
}

/** Applies every stored setting. Called once at startup, after the database is ready. */
export function loadRuntimeSettings(): void {
  const config = getConfig();
  rememberDefaults(config);
  const rows = getDb().select().from(settings).all();
  for (const row of rows) {
    if (!RUNTIME_SETTING_KEYS.includes(row.key as RuntimeSettingKey)) continue;
    const key = row.key as RuntimeSettingKey;
    const parsed = parseSettingValue(key, row.value);
    if (typeof parsed === "number") {
      apply(config, key, parsed);
    } else {
      console.warn(`[settings] Ignoring stored ${key}: ${parsed}`);
    }
  }
}

/** Stores and applies a value, or with null goes back to the environment value. */
export function setRuntimeSetting(key: RuntimeSettingKey, value: number | null): void {
  const config = getConfig();
  const defaults = rememberDefaults(config);
  const db = getDb();
  if (value === null) {
    db.delete(settings).where(eq(settings.key, key)).run();
    apply(config, key, defaults[key]);
    return;
  }
  db.insert(settings)
    .values({ key, value: String(value), updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: String(value), updatedAt: new Date() } })
    .run();
  apply(config, key, value);
}

export interface RuntimeSettingView {
  key: RuntimeSettingKey;
  kind: "bytes" | "count";
  value: number;
  envDefault: number;
  overridden: boolean;
  min: number;
  max: number;
}

/** What the panel shows: each setting with its value, its environment value and its bounds. */
export function describeRuntimeSettings(): RuntimeSettingView[] {
  const config = getConfig();
  const defaults = rememberDefaults(config);
  const stored = new Set(
    getDb()
      .select({ key: settings.key })
      .from(settings)
      .all()
      .map((row) => row.key),
  );
  return RUNTIME_SETTING_KEYS.map((key) => ({
    key,
    kind: DEFINITIONS[key].kind,
    value: config[key],
    envDefault: defaults[key],
    overridden: stored.has(key),
    min: DEFINITIONS[key].min,
    max: DEFINITIONS[key].max,
  }));
}

/** Forgets the remembered environment values. For tests. */
export function resetRuntimeSettings(): void {
  envDefaults = null;
  requestMaxFollows = true;
}
