import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: vi.fn().mockResolvedValue({ error: null }) }),
}));

import { usePushSubscription } from "../usePushSubscription";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
// Chrome's reduced Android UA: every version and model reads "Android 10; K".
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

const notification = {
  permission: "default" as NotificationPermission,
  requestPermission: vi.fn<() => Promise<NotificationPermission>>(),
};
const pushManager = { getSubscription: vi.fn(), subscribe: vi.fn() };

/** The Home Screen app on an iPhone: the only place iOS offers push. */
function onInstalledIPhone() {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(IPHONE_UA);
  Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
}

function onAndroid({ installed }: { installed: boolean }) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ANDROID_UA);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: installed && query === "(display-mode: standalone)",
  }));
}

/** Back from another app, e.g. Settings. */
function comeBack() {
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  notification.permission = "default";
  notification.requestPermission.mockReset();
  pushManager.getSubscription.mockReset().mockResolvedValue(null);
  pushManager.subscribe.mockReset();
  vi.stubGlobal("Notification", notification);
  vi.stubGlobal("PushManager", class {});
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete (navigator as { standalone?: boolean }).standalone;
});

describe("usePushSubscription", () => {
  it("points a blocked iPhone app at the Settings app", async () => {
    onInstalledIPhone();
    notification.permission = "denied";
    const { result } = renderHook(() => usePushSubscription("me"));
    await waitFor(() => expect(result.current.state).toBe("denied-ios"));
  });

  it("points a blocked Android app at its app settings", async () => {
    onAndroid({ installed: true });
    notification.permission = "denied";
    const { result } = renderHook(() => usePushSubscription("me"));
    await waitFor(() => expect(result.current.state).toBe("denied-android-app"));
  });

  it("points a blocked Android browser tab at the page's permissions", async () => {
    onAndroid({ installed: false });
    notification.permission = "denied";
    const { result } = renderHook(() => usePushSubscription("me"));
    await waitFor(() => expect(result.current.state).toBe("denied-android-browser"));
  });

  it("keeps the browser's block everywhere else", async () => {
    notification.permission = "denied";
    const { result } = renderHook(() => usePushSubscription("me"));
    await waitFor(() => expect(result.current.state).toBe("denied"));
  });

  it("points at Settings when an iPhone's prompt is turned down", async () => {
    onInstalledIPhone();
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "test-key");
    const { result } = renderHook(() => usePushSubscription("me"));
    await waitFor(() => expect(result.current.state).toBe("prompt"));

    notification.requestPermission.mockImplementation(async () => {
      notification.permission = "denied";
      return "denied";
    });
    await act(() => result.current.subscribe());

    expect(result.current.state).toBe("denied-ios");
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("offers Turn On after notifications are allowed in Settings", async () => {
    onInstalledIPhone();
    notification.permission = "denied";
    const { result } = renderHook(() => usePushSubscription("me"));
    await waitFor(() => expect(result.current.state).toBe("denied-ios"));

    notification.permission = "granted";
    comeBack();

    await waitFor(() => expect(result.current.state).toBe("unsubscribed"));
  });

  it("shows a block made in Settings without a relaunch", async () => {
    onInstalledIPhone();
    notification.permission = "granted";
    const { result } = renderHook(() => usePushSubscription("me"));
    await waitFor(() => expect(result.current.state).toBe("unsubscribed"));

    notification.permission = "denied";
    comeBack();

    expect(result.current.state).toBe("denied-ios");
  });
});
