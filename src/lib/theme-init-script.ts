import {
  COLOR_KEYS,
  CSS_VAR,
  DARK_STOPS,
  LIGHT_STOPS,
  NIGHTFALL_AT,
  SUNRISE_AT,
} from "@/lib/lamplight/palette";

/**
 * The inline theme-initialization script, kept in one place so the markup in
 * the root layout and any test that asserts on it cannot drift apart.
 *
 * This has to run synchronously in <head>, before first paint, or the page
 * flashes the wrong theme. It is a fixed literal — no user input is
 * interpolated — and is authorised by the per-request nonce that `proxy.ts`
 * puts in `script-src` and the root layout stamps onto the tag.
 *
 * In the default "Through the day" mode it blends the hour's palette, the
 * same math as palette() in src/lib/lamplight/palette.ts, built from the same
 * stops at module load so the two cannot disagree. Only the colors: the
 * lamp's glow and the meta theme color wait for the theme store on hydration.
 * A pinned Light or Dark choice needs no math — tokens.css carries both.
 * Anything else stored, including a "system" from before Lamplight, is Auto.
 */
const DATA = JSON.stringify({
  l: LIGHT_STOPS.map(([at, stop]) => [at, COLOR_KEYS.map((k) => stop[k])]),
  d: DARK_STOPS.map(([at, stop]) => [at, COLOR_KEYS.map((k) => stop[k])]),
  v: COLOR_KEYS.map((k) => CSS_VAR[k]),
  sr: SUNRISE_AT,
  nf: NIGHTFALL_AT,
});

export const THEME_INIT_SCRIPT = `(function(){try{var r=document.documentElement,t=localStorage.getItem("motive-theme");if(t==="light"||t==="dark"){var d=t==="dark";r.style.background=d?"#12151F":"#ECF2F7";if(d)r.setAttribute("data-theme","dark");return}var D=${DATA},n=new Date(),h=n.getHours()+n.getMinutes()/60,o=parseFloat(localStorage.getItem("motive-sky-hour"));if(o>=0&&o<24)h=o;var L=h>=D.sr&&h<D.nf,S=L?D.l:D.d,x=L||h>=D.nf?h:h+24,i=0;while(i<S.length-2&&x>S[i+1][0])i++;var a=S[i],b=S[i+1],u=Math.max(0,Math.min(1,(x-a[0])/(b[0]-a[0]||1)));for(var k=0;k<D.v.length;k++){var p=a[1][k],q=b[1][k],c=[];for(var j=1;j<6;j+=2){var m=parseInt(p.substr(j,2),16);c.push(Math.round(m+(parseInt(q.substr(j,2),16)-m)*u))}r.style.setProperty(D.v[k],"rgb("+c.join(", ")+")")}if(!L)r.setAttribute("data-theme","dark");r.style.background=r.style.getPropertyValue(D.v[0])}catch(e){}})()`;
