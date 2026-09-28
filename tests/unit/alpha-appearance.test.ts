import { describe, expect, it } from "vitest";
import {
  APPEARANCE_COOKIE,
  appearanceCookie,
  htmlClassFor,
  parseAppearance,
  resolveTheme,
  themeColorFor,
} from "@/lib/alpha/appearance";

describe("appearance (theme resolution)", () => {
  it("defaults to following the system for a missing or unknown cookie", () => {
    for (const value of [undefined, null, "", "Dark", "blue", 1]) expect(parseAppearance(value)).toBe("system");
    expect(parseAppearance("light")).toBe("light");
    expect(parseAppearance("dark")).toBe("dark");
  });

  it("light is the default; dark follows the OS; a forced choice beats the OS", () => {
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("sets .light / .dark on <html> only for a forced choice", () => {
    expect(htmlClassFor("system")).toBeNull();
    expect(htmlClassFor("light")).toBe("light");
    expect(htmlClassFor("dark")).toBe("dark");
  });

  it("theme-color is paper for each mode: both schemes when following the OS, else the forced one", () => {
    expect(themeColorFor("system")).toEqual([
      { media: "(prefers-color-scheme: light)", color: "#F2F2EE" },
      { media: "(prefers-color-scheme: dark)", color: "#0C0D0F" },
    ]);
    expect(themeColorFor("light")).toEqual([{ color: "#F2F2EE" }]);
    expect(themeColorFor("dark")).toEqual([{ color: "#0C0D0F" }]);
  });

  it("stores a forced choice for a year and clears it for system", () => {
    expect(APPEARANCE_COOKIE).toBe("alpha-appearance");
    expect(appearanceCookie("dark")).toBe("alpha-appearance=dark; Path=/; SameSite=Lax; Max-Age=31536000");
    expect(appearanceCookie("system")).toBe("alpha-appearance=; Path=/; SameSite=Lax; Max-Age=0");
  });
});
