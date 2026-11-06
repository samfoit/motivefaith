/**
 * Folds text for matching: lowercase, accents removed, so "jose" finds
 * "José" and "ZOE" finds "Zoë".
 */
export function foldForSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Splits a search into the words that must each be found. A leading "@" is
 * dropped from each, since usernames are shown and shared as "@name".
 */
export function searchTerms(query: string): string[] {
  return foldForSearch(query)
    .split(/\s+/)
    .map((term) => term.replace(/^@+/, ""))
    .filter(Boolean);
}

/**
 * Whether every term appears somewhere in `fields`, in any order and across
 * fields: "sam run" finds Sam, who shares Morning Run. No terms matches all.
 */
export function matchesSearch(
  fields: (string | null | undefined)[],
  terms: string[],
): boolean {
  if (terms.length === 0) return true;
  const haystack = fields.filter(Boolean).map((f) => foldForSearch(f!));
  return terms.every((term) => haystack.some((field) => field.includes(term)));
}
