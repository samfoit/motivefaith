import { describe, it, expect } from "vitest";
import { foldForSearch, matchesSearch, searchTerms } from "../search-match";

describe("search matching", () => {
  it("ignores case and accents", () => {
    expect(foldForSearch("José ZOË")).toBe("jose zoe");
    expect(matchesSearch(["José"], searchTerms("jose"))).toBe(true);
    expect(matchesSearch(["Jose"], searchTerms("JOSÉ"))).toBe(true);
  });

  it("drops a leading @ so a pasted username matches", () => {
    expect(searchTerms("@sam_r")).toEqual(["sam_r"]);
    expect(matchesSearch(["Sam Rivera", "sam_r"], searchTerms("@sam"))).toBe(true);
  });

  it("needs every word, found in any field and any order", () => {
    const sam = ["Sam Rivera", "sam_r", "Morning Run", "Scripture"];
    expect(matchesSearch(sam, searchTerms("run sam"))).toBe(true);
    expect(matchesSearch(sam, searchTerms("sam yoga"))).toBe(false);
  });

  it("matches everything when the search is blank", () => {
    expect(searchTerms("   ")).toEqual([]);
    expect(matchesSearch(["anything"], searchTerms(""))).toBe(true);
  });

  it("skips missing fields", () => {
    expect(matchesSearch([null, undefined, "Ana"], searchTerms("ana"))).toBe(true);
  });
});
