"use client";

import { useEffect, type RefObject } from "react";

/**
 * Keeps a fixed-position input bar pinned above the on-screen keyboard.
 *
 * Uses two signals:
 * 1. `focusin`/`focusout` on the bar to know when the keyboard is open
 *    (does NOT reposition during the tap — that would cancel focus on iOS).
 * 2. Visual Viewport `resize`/`scroll` to compute the correct `bottom` offset
 *    and keep it updated as the user scrolls with the keyboard open.
 *
 * Directly manipulates `el.style` via the ref to avoid React re-renders.
 */
export function useKeyboardOffset(
  ref: RefObject<HTMLElement | null>,
  defaultCSS: string = "0px",
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const vv = window.visualViewport;
    let focused = false;

    const reposition = () => {
      if (!focused) {
        el.style.bottom = defaultCSS;
        el.style.zIndex = "";
        return;
      }

      // Keyboard is open. Compute how far the visual viewport's bottom edge
      // is from the layout viewport's bottom edge. Clamp to 0 for overscroll.
      let bottom = 0;
      if (vv) {
        bottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      }
      el.style.bottom = `${bottom}px`;
      el.style.zIndex = "50"; // above BottomNav (z-40)
    };

    const onFocusIn = () => {
      focused = true;
      // Don't call reposition() here — moving the element during the tap
      // causes iOS to cancel the touch and dismiss the keyboard.
      // The Visual Viewport resize event will fire once the keyboard
      // starts animating, and reposition there.
    };

    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget && el.contains(e.relatedTarget as Node)) return;
      focused = false;
      reposition();
    };

    el.addEventListener("focusin", onFocusIn);
    el.addEventListener("focusout", onFocusOut);

    if (vv) {
      vv.addEventListener("resize", reposition);
      vv.addEventListener("scroll", reposition);
    }

    return () => {
      el.removeEventListener("focusin", onFocusIn);
      el.removeEventListener("focusout", onFocusOut);
      if (vv) {
        vv.removeEventListener("resize", reposition);
        vv.removeEventListener("scroll", reposition);
      }
      el.style.bottom = "";
      el.style.zIndex = "";
    };
  }, [ref, defaultCSS]);
}
