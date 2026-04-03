"use client";

import { useState, useEffect } from "react";

/**
 * Returns the number of pixels the virtual keyboard overlaps the layout
 * viewport. Returns 0 on desktop or when the keyboard is hidden.
 */
export function useKeyboardOffset(): number {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const keyboardHeight = window.innerHeight - vv.height;
      // Ignore tiny fluctuations (address bar, etc.)
      setOffset(keyboardHeight > 40 ? keyboardHeight : 0);
    };

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);

    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return offset;
}
