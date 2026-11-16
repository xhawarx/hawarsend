import { afterEach, describe, expect, it } from "vitest";
import i18next from "i18next";
import { formatDuration, formatRemainingMs } from "../../src/lib/utils.js";

describe("durations in the language of the page", () => {
  afterEach(async () => {
    await i18next.changeLanguage("en");
  });

  it("keeps the compact English letters", async () => {
    await i18next.init({ lng: "en", resources: {} });
    expect(formatDuration(3600)).toBe("1h");
    expect(formatRemainingMs((23 * 3600 + 59 * 60) * 1000)).toBe("23h 59m");
  });

  it("writes Turkish units instead of English letters", async () => {
    await i18next.init({ lng: "tr", resources: {} });
    expect(formatDuration(3600)).not.toMatch(/^\d+h$/);
    expect(formatDuration(3600)).toContain("sa");
    expect(formatDuration(7 * 86400)).toContain("gün");
    expect(formatRemainingMs((23 * 3600 + 59 * 60) * 1000)).toMatch(/23.*sa.*59.*dk/);
  });
});
