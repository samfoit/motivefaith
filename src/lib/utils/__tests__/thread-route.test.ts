import { describe, it, expect } from "vitest";
import { isThreadRoute } from "../thread-route";

describe("isThreadRoute", () => {
  it.each([
    "/main/feed/b2222222-2222-2222-2222-222222222222",
    "/main/feed/group/01111111-1111-1111-1111-111111111111",
  ])("is a chat screen: %s", (path) => {
    expect(isThreadRoute(path)).toBe(true);
  });

  it.each([
    "/main/feed",
    "/main/feed/new-group",
    "/main/feed/join/abc123",
    "/main/feed/group/01111111-1111-1111-1111-111111111111/settings",
    "/main/dashboard",
    null,
  ])("is not a chat screen: %s", (path) => {
    expect(isThreadRoute(path)).toBe(false);
  });
});
