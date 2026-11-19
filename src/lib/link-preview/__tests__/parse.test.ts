import { describe, it, expect } from "vitest";
import { decodeEntities, declaredCharset, parsePreview } from "../parse";

const page = (head: string) => `<!doctype html><html><head>${head}</head><body><meta property="og:title" content="from the body"></body></html>`;

describe("parsePreview", () => {
  it("reads the OpenGraph tags", () => {
    const p = parsePreview(
      page(`
        <meta property="og:title" content="Psalm 23">
        <meta property="og:description" content="The Lord is my shepherd">
        <meta property="og:site_name" content="Bible Gateway">
        <meta property="og:image" content="/img/psalm.jpg">
        <title>ignored</title>`),
      "https://www.biblegateway.com/passage/?search=Psalm+23",
    );
    expect(p).toEqual({
      title: "Psalm 23",
      description: "The Lord is my shepherd",
      siteName: "Bible Gateway",
      image: "https://www.biblegateway.com/img/psalm.jpg",
      largeImage: true,
    });
  });

  it("falls back to Twitter tags, then <title> and the plain description", () => {
    expect(parsePreview(page(`<meta name="twitter:title" content="T"><meta name="twitter:image" content="https://x.com/i.png">`), "https://a.com").title).toBe("T");
    const plain = parsePreview(page(`<title> A   page </title><meta name="description" content="About it">`), "https://a.com");
    expect(plain.title).toBe("A page");
    expect(plain.description).toBe("About it");
    expect(plain.image).toBeNull();
  });

  it("reads attributes in any order and quoting", () => {
    const p = parsePreview(page(`<meta content='Single' property=og:title>`), "https://a.com");
    expect(p.title).toBe("Single");
  });

  it("ignores tags in the body", () => {
    expect(parsePreview(page(""), "https://a.com").title).toBeNull();
  });

  it("decodes entities", () => {
    const p = parsePreview(page(`<meta property="og:title" content="Faith &amp; Works &#8212; &#x2014; &rsquo;">`), "https://a.com");
    expect(p.title).toBe("Faith & Works — — ’");
  });

  it("decodes text a site escaped twice", () => {
    const p = parsePreview(page(`<meta property="og:description" content="for his name&amp;#039;s sake">`), "https://a.com");
    expect(p.description).toBe("for his name's sake");
  });

  it("never takes a picture that isn't http(s)", () => {
    const p = parsePreview(page(`<meta property="og:title" content="t"><meta property="og:image" content="javascript:alert(1)">`), "https://a.com");
    expect(p.image).toBeNull();
  });

  it("shows a thumbnail for a summary card or a small picture", () => {
    const summary = parsePreview(page(`<meta name="twitter:card" content="summary"><meta property="og:image" content="https://a.com/i.png">`), "https://a.com");
    expect(summary.largeImage).toBe(false);
    const square = parsePreview(page(`<meta property="og:image" content="https://a.com/i.png"><meta property="og:image:width" content="600"><meta property="og:image:height" content="600">`), "https://a.com");
    expect(square.largeImage).toBe(false);
    const wide = parsePreview(page(`<meta property="og:image" content="https://a.com/i.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`), "https://a.com");
    expect(wide.largeImage).toBe(true);
  });

  it("shortens a long description", () => {
    const p = parsePreview(page(`<meta property="og:description" content="${"word ".repeat(200)}">`), "https://a.com");
    expect(p.description!.length).toBeLessThanOrEqual(300);
    expect(p.description!.endsWith("…")).toBe(true);
  });
});

describe("decodeEntities", () => {
  it("leaves unknown and invalid entities alone", () => {
    expect(decodeEntities("&bogus; &#0; &#xFFFFFFF;")).toBe("&bogus; &#0; &#xFFFFFFF;");
  });
});

describe("declaredCharset", () => {
  it("reads both meta forms", () => {
    expect(declaredCharset(`<meta charset="Shift_JIS">`)).toBe("shift_jis");
    expect(declaredCharset(`<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">`)).toBe("windows-1252");
    expect(declaredCharset("<title>x</title>")).toBeNull();
  });
});
