import { describe, it, expect, beforeEach, vi } from "vitest";

// We need to re-import the store fresh for some tests, so use dynamic imports
// and reset modules between tests.

beforeEach(() => {
  // Clear localStorage
  localStorage.clear();
  // Remove data-theme attribute and any inline palette
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
  // Reset module registry so Zustand store re-initializes
  vi.resetModules();
});

async function getStore() {
  const mod = await import("../theme-store");
  return mod;
}

describe("useThemeStore", () => {
  it("defaults to 'day' preference", async () => {
    const { useThemeStore } = await getStore();
    expect(useThemeStore.getState().preference).toBe("day");
  });

  it("falls back to 'day' for an unknown stored value", async () => {
    localStorage.setItem("motive-theme", "sepia");
    const { useThemeStore } = await getStore();
    expect(useThemeStore.getState().preference).toBe("day");
  });

  it.each(["light", "dark", "system"] as const)(
    "still loads a stored '%s' from before Lamplight",
    async (pref) => {
      localStorage.setItem("motive-theme", pref);
      const { useThemeStore } = await getStore();
      expect(useThemeStore.getState().preference).toBe(pref);
    },
  );

  it("setTheme('dark') stores in localStorage and sets data-theme='dark'", async () => {
    const { useThemeStore } = await getStore();
    useThemeStore.getState().setTheme("dark");
    expect(localStorage.getItem("motive-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(useThemeStore.getState().preference).toBe("dark");
    expect(useThemeStore.getState().resolved).toBe("dark");
  });

  it("setTheme('light') removes data-theme from document root", async () => {
    const { useThemeStore } = await getStore();
    // First set to dark
    useThemeStore.getState().setTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    // Then set to light
    useThemeStore.getState().setTheme("light");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(useThemeStore.getState().resolved).toBe("light");
  });

  it("reads stored preference from localStorage on init", async () => {
    localStorage.setItem("motive-theme", "dark");
    const { useThemeStore } = await getStore();
    expect(useThemeStore.getState().preference).toBe("dark");
    expect(useThemeStore.getState().resolved).toBe("dark");
  });

  it("resolves 'system' to 'light' when prefers-color-scheme is light", async () => {
    // matchMedia is mocked to return matches: false in setup
    const { useThemeStore } = await getStore();
    useThemeStore.getState().setTheme("system");
    expect(useThemeStore.getState().resolved).toBe("light");
  });
});

describe("initializeTheme", () => {
  it("applies resolved theme to DOM", async () => {
    localStorage.setItem("motive-theme", "dark");
    const { initializeTheme } = await getStore();
    initializeTheme();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("does not set data-theme for light mode", async () => {
    localStorage.setItem("motive-theme", "light");
    const { initializeTheme } = await getStore();
    initializeTheme();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});

describe("'day' mode", () => {
  const root = () => document.documentElement;

  it.each([
    [21.5, "dark"],
    [3, "dark"],
    [13, "light"],
    [6.5, "light"],
  ] as const)("at hour %s writes the palette inline and resolves %s", async (hour, family) => {
    localStorage.setItem("motive-sky-hour", String(hour));
    const { initializeTheme, useThemeStore } = await getStore();
    const { palette } = await import("@/lib/lamplight/palette");
    initializeTheme();
    expect(useThemeStore.getState().resolved).toBe(family);
    expect(useThemeStore.getState().hour).toBe(hour);
    expect(root().getAttribute("data-theme") === "dark").toBe(family === "dark");
    expect(root().style.getPropertyValue("--color-bg-primary")).toBe(
      palette(hour).vars["--color-bg-primary"],
    );
  });

  it("follows the clock minute by minute", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 14, 19, 59, 30));
    try {
      const { initializeTheme, useThemeStore } = await getStore();
      initializeTheme();
      expect(useThemeStore.getState().resolved).toBe("light");
      vi.advanceTimersByTime(60_000);
      expect(useThemeStore.getState().resolved).toBe("dark");
      expect(root().getAttribute("data-theme")).toBe("dark");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a pin clears the inline palette and shows its own sky hour", async () => {
    localStorage.setItem("motive-sky-hour", "13");
    const { initializeTheme, useThemeStore } = await getStore();
    initializeTheme();
    expect(root().style.getPropertyValue("--color-bg-primary")).not.toBe("");
    useThemeStore.getState().setTheme("dark");
    expect(root().style.getPropertyValue("--color-bg-primary")).toBe("");
    expect(useThemeStore.getState().hour).toBe(22);
  });
});

describe("THEME_INIT_SCRIPT", () => {
  async function run() {
    const { THEME_INIT_SCRIPT } = await import("@/lib/theme-init-script");
    new Function(THEME_INIT_SCRIPT)();
    return document.documentElement;
  }

  it.each([3, 6.5, 13, 18.5, 21.5])(
    "paints the same blend as palette() at hour %s",
    async (hour) => {
      localStorage.setItem("motive-sky-hour", String(hour));
      const { palette, ALL_VARS } = await import("@/lib/lamplight/palette");
      const root = await run();
      const { vars, light } = palette(hour);
      for (const name of ALL_VARS.filter((n) => n.startsWith("--color") || n.startsWith("--sky"))) {
        expect(root.style.getPropertyValue(name), name).toBe(vars[name]);
      }
      expect(root.getAttribute("data-theme") === "dark").toBe(!light);
    },
  );

  it("leaves a pinned choice to tokens.css", async () => {
    localStorage.setItem("motive-theme", "dark");
    const root = await run();
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.style.getPropertyValue("--color-bg-primary")).toBe("");
  });
});
