"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Lets a page put its own title and buttons into the TopBar.
 *
 * The bar lives in the layout so it survives navigation and is already there
 * for loading and error states; the page is a sibling of it, not a child. The
 * bar registers its two slot elements here through ref callbacks, and a page
 * portals into them. Refs rather than `getElementById` because on a client
 * navigation the bar's slots and the page mount in the same commit: a lookup
 * during render would run before the slot exists and never look again.
 *
 * Portaled content keeps the page's React context and state — the Invite
 * button in the bar still opens the sheet the Friends page owns.
 */
type SlotName = "title" | "actions";

const slots: Record<SlotName, HTMLElement | null> = { title: null, actions: null };
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setSlot(name: SlotName, el: HTMLElement | null) {
  if (slots[name] === el) return;
  slots[name] = el;
  for (const l of listeners) l();
}

/** Ref callbacks for the TopBar's slot elements. Module-level, so stable. */
export function registerTitleSlot(el: HTMLElement | null) {
  setSlot("title", el);
}

export function registerActionsSlot(el: HTMLElement | null) {
  setSlot("actions", el);
}

function TopBarSlot({ name, children }: { name: SlotName; children: ReactNode }) {
  const target = useSyncExternalStore(
    subscribe,
    () => slots[name],
    // Nothing on the server: the bar's slots are filled after hydration.
    () => null,
  );
  return target ? createPortal(children, target) : null;
}

/** Replaces the bar's title. Only used on screens whose title is dynamic. */
export function TopBarTitle({ children }: { children: ReactNode }) {
  return <TopBarSlot name="title">{children}</TopBarSlot>;
}

/** Buttons shown in the bar, to the left of the inbox bell. */
export function TopBarActions({ children }: { children: ReactNode }) {
  return <TopBarSlot name="actions">{children}</TopBarSlot>;
}


/**
 * Overrides what the bar's back arrow does on a sub-page. Read at click time,
 * so changing it never re-renders the bar. `null` restores the default.
 */
let backHandler: (() => void) | null = null;

export function getTopBarBackHandler() {
  return backHandler;
}

/**
 * The new-habit wizard's arrow steps back through the wizard before it leaves
 * the page: it passes its step handler while there is a step to go back to.
 */
export function useTopBarBack(handler: (() => void) | null) {
  useEffect(() => {
    backHandler = handler;
    return () => {
      if (backHandler === handler) backHandler = null;
    };
  }, [handler]);
}
