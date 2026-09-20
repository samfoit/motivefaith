/**
 * TCP latency proxy: listen on LISTEN_PORT, forward to UPSTREAM_PORT, adding
 * DELAY_MS to every chunk in both directions (so ~2*DELAY_MS added RTT).
 *
 * Used to make a local Supabase behave like a hosted one, so that server-side
 * auth/DB round trips cost what they cost in production and Suspense fallbacks
 * actually flush.
 */
import net from "net";

const LISTEN = Number(process.env.LISTEN_PORT ?? 54321);
const UPSTREAM = Number(process.env.UPSTREAM_PORT ?? 54331);
const DELAY = Number(process.env.DELAY_MS ?? 40);

/**
 * Pipe src->dst, delaying only the FIRST chunk of each "burst" by DELAY, so a
 * multi-chunk response pays one RTT rather than one per packet. A burst is a
 * run of chunks with no idle gap; a gap of >5ms means a new request/response,
 * which pays the latency again.
 */
function delayedPipe(src, dst) {
  let chain = Promise.resolve();
  let lastAt = 0;
  src.on("data", (chunk) => {
    const now = Date.now();
    const newBurst = now - lastAt > 5;
    lastAt = now;
    const wait = newBurst ? DELAY : 0;
    chain = chain.then(
      () =>
        new Promise((resolve) => {
          const go = () => {
            if (!dst.destroyed) dst.write(chunk);
            lastAt = Date.now();
            resolve();
          };
          if (wait) setTimeout(go, wait);
          else go();
        }),
    );
  });
  src.on("end", () => {
    chain = chain.then(() => {
      if (!dst.destroyed) dst.end();
    });
  });
  src.on("error", () => dst.destroy());
}

net
  .createServer((client) => {
    const upstream = net.connect(UPSTREAM, "127.0.0.1");
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
    delayedPipe(client, upstream);
    delayedPipe(upstream, client);
  })
  .listen(LISTEN, "127.0.0.1", () => {
    console.log(`latency proxy :${LISTEN} -> :${UPSTREAM} (+${DELAY}ms each way)`);
  });
