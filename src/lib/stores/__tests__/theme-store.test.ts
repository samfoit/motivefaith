import { describe, it, expect, beforeEach, vi } from "vitest";

// We need to re-import the store fresh for some tests, so use dynamic imports
// and reset modules between tests.

beforeEach(() => {
  // Clear localStorage
  localStorage.clear();
  // Remove data-theme attribute
  document.documentElement.removeAttribute("data-theme");
  // Reset module registry so Zustand store re-initializes
  vi.resetModules();
});

async function getStore() {
  const mod = await import("../theme-store");
  return mod;
}

describe("useThemeStore", () => {
  it("defaults to 'system' preference", async () => {
    const { useThemeStore } = await getStore();
    expect(useThemeStore.getState().preference).toBe("system");
  });

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
