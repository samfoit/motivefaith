/**
 * The inline theme-initialization script, kept in one place so the markup in
 * the root layout and any test that asserts on it cannot drift apart.
 *
 * This has to run synchronously in <head>, before first paint, or the page
 * flashes the wrong theme. It is a fixed literal — no user input is
 * interpolated — and is authorised by the per-request nonce that `proxy.ts`
 * puts in `script-src` and the root layout stamps onto the tag.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("motive-theme");var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme:dark)").matches);document.documentElement.style.background=d?"#1a1a1e":"#fafaf9";if(d)document.documentElement.setAttribute("data-theme","dark")}catch(e){}})()`;
