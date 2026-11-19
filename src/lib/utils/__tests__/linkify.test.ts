import { describe, it, expect } from "vitest";
import { firstLink, linkify } from "../linkify";

const links = (text: string) =>
  linkify(text).filter((s) => s.kind === "link").map((s) => (s.kind === "link" ? [s.text, s.href] : []));

describe("linkify", () => {
  it("leaves text without links as one piece", () => {
    expect(linkify("praying for you today")).toEqual([{ kind: "text", text: "praying for you today" }]);
  });

  it("splits text around a link and keeps every character", () => {
    const text = "read this https://example.com/psalm-23 tonight";
    const segments = linkify(text);
    expect(segments).toEqual([
      { kind: "text", text: "read this " },
      { kind: "link", text: "https://example.com/psalm-23", href: "https://example.com/psalm-23" },
      { kind: "text", text: " tonight" },
    ]);
    expect(segments.map((s) => s.text).join("")).toBe(text);
  });

  it("opens a www. link over https", () => {
    expect(links("www.biblegateway.com")).toEqual([["www.biblegateway.com", "https://www.biblegateway.com/"]]);
  });

  it("leaves a bare domain as text", () => {
    expect(links("check example.com later")).toEqual([]);
  });

  it("leaves sentence punctuation off the end", () => {
    expect(links("See https://example.com/a.")).toEqual([["https://example.com/a", "https://example.com/a"]]);
    expect(links("Did you see https://example.com/a?!")).toEqual([["https://example.com/a", "https://example.com/a"]]);
  });

  it("keeps a bracket pair the link opened, and drops one it didn't", () => {
    expect(links("(https://en.wikipedia.org/wiki/Faith_(virtue))")).toEqual([
      ["https://en.wikipedia.org/wiki/Faith_(virtue)", "https://en.wikipedia.org/wiki/Faith_(virtue)"],
    ]);
  });

  it("keeps a query and a fragment", () => {
    expect(links("https://youtu.be/abc?t=42#x")).toEqual([["https://youtu.be/abc?t=42#x", "https://youtu.be/abc?t=42#x"]]);
  });

  it("finds several links", () => {
    expect(links("https://a.com and https://b.org")).toHaveLength(2);
  });

  it("never makes a link of another scheme", () => {
    expect(links("javascript:alert(1) data:text/html,hi")).toEqual([]);
  });

  it("needs a dotted host", () => {
    expect(links("http://localhost:3000")).toEqual([]);
  });
});

describe("firstLink", () => {
  it("is the first link's address", () => {
    expect(firstLink("one www.a.com two https://b.com")).toBe("https://www.a.com/");
  });

  it("is null without one", () => {
    expect(firstLink("nothing here")).toBeNull();
  });
});
