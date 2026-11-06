"use client";

import { useRef } from "react";
import { Search, X } from "lucide-react";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** What's being searched, for screen readers. Defaults to the placeholder. */
  label?: string;
}

/**
 * A search field: a search keyboard on phones (no autocapitalize or
 * autocorrect, which mangle names and usernames), a clear button once
 * there's text, and Escape to clear. The browser's own clear control is
 * hidden so there's only ever one.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  label,
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="relative">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]"
      />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            onChange("");
          }
        }}
        placeholder={placeholder}
        aria-label={label ?? placeholder.replace(/…$/, "")}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        className="w-full rounded-lg bg-elevated ring-1 ring-border ps-9 pe-11 py-2.5 text-base text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-brand-ink transition-shadow [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          // 44px target around a 16px glyph, flush with the field's end.
          className="absolute end-0 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-brand-ink"
        >
          <X aria-hidden="true" className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
