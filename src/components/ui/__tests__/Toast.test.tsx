import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { ToastProvider, useToast, type ToastVariant } from "../Toast";

function Harness({ variant }: { variant?: ToastVariant }) {
  const { show, ToastElements } = useToast();
  useEffect(() => {
    show({ title: "Saved", description: "Your habit was updated", variant });
    // Show once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <>{ToastElements}</>;
}

async function renderToast(variant?: ToastVariant) {
  render(
    <ToastProvider>
      <Harness variant={variant} />
    </ToastProvider>,
  );
  return (await screen.findByText("Saved")).closest("[data-variant]") as HTMLElement;
}

describe("Toast", () => {
  it.each([
    ["success", "var(--color-brand)"],
    ["error", "var(--color-miss)"],
    ["info", "var(--color-text-tertiary)"],
    ["encourage", "var(--color-encourage)"],
  ] as const)("tints a %s toast with its hue through .toast-tint", async (variant, hue) => {
    const root = await renderToast(variant);
    expect(root.className).toContain("toast-tint");
    expect(root.style.getPropertyValue("--toast-hue")).toBe(hue);
    expect(root).toHaveAttribute("data-variant", variant);
  });

  it("defaults to info", async () => {
    const root = await renderToast();
    expect(root).toHaveAttribute("data-variant", "info");
  });

  it("keeps its words in the hour's ink and uses no raw Tailwind palette colors", async () => {
    const root = await renderToast("error");
    expect(root.className).toContain("text-text-primary");
    expect(screen.getByText("Your habit was updated").className).toContain("text-text-secondary");
    expect(root.outerHTML).not.toMatch(
      /\b(?:bg|text|border)-(?:green|red|sky|violet|white)(?:-\d+|\/\d+)?\b/,
    );
  });
});
