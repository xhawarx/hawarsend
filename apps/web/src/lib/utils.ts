import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import i18next from "i18next";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  const value = bytes / k ** i;
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

type DurationUnit = "second" | "minute" | "hour" | "day";

const LETTERS: Record<DurationUnit, string> = { second: "s", minute: "m", hour: "h", day: "d" };

/**
 * One amount of a unit in the language of the page: "1h" in English, "1 sa." in Turkish,
 * "1 Std." in German. English keeps its compact letters. Outside the page, in a worker or a test
 * where i18next is not set up, the English form is used as well.
 */
function unit(amount: number, kind: DurationUnit): string {
  const lang = i18next.language;
  if (!lang || lang.startsWith("en") || lang === "cimode") return `${amount}${LETTERS[kind]}`;
  try {
    return new Intl.NumberFormat(lang, { style: "unit", unit: kind, unitDisplay: "short" }).format(amount);
  } catch {
    return `${amount}${LETTERS[kind]}`;
  }
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return unit(seconds, "second");
  if (seconds < 3600) return unit(Math.floor(seconds / 60), "minute");
  if (seconds < 86400) return unit(Math.floor(seconds / 3600), "hour");
  return unit(Math.floor(seconds / 86400), "day");
}

/** Time left until a moment, as one or two units, "23h 59m" or "23 sa. 59 dk.". */
export function formatRemainingMs(remaining: number): string {
  const seconds = Math.floor(Math.max(0, remaining) / 1000);
  if (seconds < 60) return unit(seconds, "second");
  if (seconds < 3600) return unit(Math.floor(seconds / 60), "minute");
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${unit(h, "hour")} ${unit(m, "minute")}` : unit(h, "hour");
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return h > 0 ? `${unit(d, "day")} ${unit(h, "hour")}` : unit(d, "day");
}

export function formatTimeRemaining(expiresAt: string): string {
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (remaining < 1000) return i18next.isInitialized ? i18next.t("myUploads.expired") : "expired";
  return formatRemainingMs(remaining);
}

/**
 * Detect Safari (including all iOS browsers which use WebKit).
 * Matches Mozilla Send's approach: Safari is excluded from SW streaming.
 */
export function isSafari(): boolean {
  const ua = navigator.userAgent;
  return /safari/i.test(ua) && !/chrome|chromium|edg|opr|opera|brave/i.test(ua);
}

/** Detect Firefox. */
export function isFirefox(): boolean {
  return /firefox/i.test(navigator.userAgent);
}

/** Detect Brave, whose user agent names only Chrome. */
export function isBrave(): boolean {
  return "brave" in navigator;
}

/**
 * Detect whether browser DevTools are currently open by measuring the
 * difference between outer and inner window height. DevTools docked at the
 * bottom, where Firefox puts them by default, create a gap larger than the threshold.
 *
 * Only the height counts. The sidebars of Firefox (vertical tabs, bookmarks), Chrome and Edge
 * narrow the page exactly like DevTools docked to the side, so a width gap tells nothing.
 *
 * Limitation: DevTools docked to the side or undocked in a separate window are not detectable.
 *
 * A phone or tablet docks no DevTools, and the address bar and toolbar of its browser alone
 * make a gap above the threshold, so a touch screen as the main pointer always answers no.
 */
export function isDevToolsOpen(): boolean {
  if (window.matchMedia?.("(pointer: coarse)").matches) return false;
  const threshold = 160;
  return window.outerHeight - window.innerHeight > threshold;
}

/** 256 MB - files above this threshold show a warning on Safari */
export const SAFARI_BIG_SIZE = 256 * 1024 * 1024;

/**
 * Returns a human-readable browser name and major version string,
 * e.g. "Firefox 127", "Chrome 124", "Safari 17", "Edge 124".
 * Falls back to "Unknown Browser" if the UA cannot be parsed.
 */
export function getBrowserInfo(): string {
  const ua = navigator.userAgent;
  const edgeMatch = ua.match(/Edg\/(\d+)/);
  if (edgeMatch) return `Edge ${edgeMatch[1]}`;
  const firefoxMatch = ua.match(/Firefox\/(\d+)/);
  if (firefoxMatch) return `Firefox ${firefoxMatch[1]}`;
  const chromeMatch = ua.match(/Chrome\/(\d+)/);
  if (chromeMatch) return `${isBrave() ? "Brave" : "Chrome"} ${chromeMatch[1]}`;
  const safariMatch = ua.match(/Version\/(\d+).*Safari/);
  if (safariMatch) return `Safari ${safariMatch[1]}`;
  return "Unknown Browser";
}
