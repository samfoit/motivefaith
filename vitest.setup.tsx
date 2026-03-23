/* eslint-disable @typescript-eslint/no-unused-vars, @next/next/no-img-element, jsx-a11y/alt-text */
import "@testing-library/jest-dom/vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/main/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock next/image
vi.mock("next/image", () => ({
  default: ({ fill, ...rest }: Record<string, unknown>) => (
    <img {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} />
  ),
}));

// Mock next/dynamic
vi.mock("next/dynamic", () => ({
  default: (_loader: () => Promise<{ default: React.ComponentType }>) => {
    const Component = (props: Record<string, unknown>) => (
      <div data-testid="dynamic-component" {...props} />
    );
    Component.displayName = "DynamicComponent";
    return Component;
  },
}));

// Mock motion/react to avoid animation issues in tests
vi.mock("motion/react", () => ({
  motion: new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (typeof prop === "string") {
          const MotionComponent = ({ children, initial, animate, exit, variants, whileHover, whileTap, custom, transition, layout, layoutId, ...rest }: Record<string, unknown>) => {
            const Tag = prop as keyof JSX.IntrinsicElements;
            return <Tag {...(rest as Record<string, unknown>)}>{children as React.ReactNode}</Tag>;
          };
          MotionComponent.displayName = `motion.${prop}`;
          return MotionComponent;
        }
      },
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Stub IntersectionObserver
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

// Stub matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
