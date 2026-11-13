/**
 * Whether the page is running on WebKit: Safari, every browser on an iPhone
 * or iPad, and a web app installed to their home screen.
 *
 * For the few places where WebKit's media stack needs different handling
 * that no feature test can tell apart: it says yes to recording WebM, then
 * plays WebM through a player that Web Audio cannot tap and that reports no
 * length until the whole file has arrived.
 *
 * The vendor string, not the user agent: an installed web app's user agent
 * has no "Safari" in it, and Chrome and Firefox on iOS are WebKit underneath.
 */
export function isWebKit(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.vendor === "Apple Computer, Inc.";
}
