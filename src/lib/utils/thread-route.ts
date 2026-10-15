/**
 * The chat screens: a friend's thread (/main/feed/<friendId>) and a group's
 * (/main/feed/group/<groupId>), not the group's settings or the feed's other
 * pages.
 *
 * They keep a message composer fixed above the bottom nav, which rides up
 * with the on-screen keyboard (useKeyboardOffset). Anything else pinned to
 * the bottom of the screen has to stay out of its way there.
 */
const THREAD_ROUTE = /^\/main\/feed\/(?:group\/[^/]+|(?!group$|join$|new-group$)[^/]+)$/;

export function isThreadRoute(pathname: string | null | undefined): boolean {
  return THREAD_ROUTE.test(pathname ?? "");
}
