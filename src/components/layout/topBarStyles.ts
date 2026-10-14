/**
 * Class names shared by everything that renders into the TopBar, kept apart
 * from the bar itself so pages and the bell can import them without a cycle.
 */

/** Shared by every bar title, so they are the same size on every screen. */
export const TOP_BAR_TITLE_CLASS =
  "font-display font-bold text-text-primary truncate leading-tight tracking-tight";

/**
 * Scales with the viewport so a phone keeps room for the bar's buttons: at a
 * fixed size, "Good afternoon, " alone filled a 375px screen and the name was
 * truncated away.
 */
export const TOP_BAR_TITLE_STYLE = {
  fontSize: "clamp(1.125rem, 3vw + 0.5rem, var(--text-xl))",
} as const;

/**
 * The bar's two button styles. Every screen's buttons use one or the other,
 * so the bar reads the same wherever you are.
 *
 * Icon buttons are 40px with the tap area stretched to 48px by an invisible
 * pseudo-element — big enough to hit, without the row needing 48px per
 * button. Neighbours sit 8px apart, so the stretched areas meet but do not
 * overlap.
 */
export const TOP_BAR_ICON_BUTTON_CLASS =
  "relative flex items-center justify-center w-10 h-10 rounded-full text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors after:absolute after:-inset-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

/**
 * A screen's main action (New Group, Invite, new habit). Filled, but a
 * compact rounded rectangle rather than a floating circle, so it leads the
 * row without outweighing the title. Icon-only where the title needs the room.
 */
export const TOP_BAR_PRIMARY_ACTION_CLASS =
  "relative flex items-center justify-center gap-1.5 h-8 min-w-9 px-2.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors after:absolute after:-inset-x-1 after:-inset-y-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
