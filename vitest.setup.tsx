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

// ---------------------------------------------------------------------------
// Web Storage
//
// Node 22+ ships its own `localStorage` / `sessionStorage` globals, which are
// `undefined` unless the process is started with `--localstorage-file`. Those
// native globals shadow the implementations jsdom installs, so without this
// every `localStorage.*` call in a test throws
// "Cannot read properties of undefined". Both descriptors are configurable,
// so replace them with a spec-shaped in-memory store.
// ---------------------------------------------------------------------------

class MemoryStorage implements Storage {
  #entries = new Map<string, string>();

  get length() {
    return this.#entries.size;
  }
  key(index: number): string | null {
    return [...this.#entries.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.#entries.get(String(key)) ?? null;
  }
  setItem(key: string, value: string): void {
    this.#entries.set(String(key), String(value));
  }
  removeItem(key: string): void {
    this.#entries.delete(String(key));
  }
  clear(): void {
    this.#entries.clear();
  }
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  if (!globalThis[name]) {
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, name, {
      value: storage,
      configurable: true,
      writable: true,
    });
    // jsdom's `window` is the same object as `globalThis` here, but define it
    // explicitly so this keeps working if that ever stops being true.
    if (window !== (globalThis as unknown as Window)) {
      Object.defineProperty(window, name, {
        value: storage,
        configurable: true,
        writable: true,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Pointer Capture API
//
// jsdom implements pointer events but not pointer capture, so anything that
// captures a pointer mid-gesture (Radix's swipe-to-dismiss, the habit card's
// check-in drag) throws "target.hasPointerCapture is not a function" the
// moment a test presses a pointer down. Capture is a no-op here; reporting
// "nothing captured" is the honest answer.
// ---------------------------------------------------------------------------

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}

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
