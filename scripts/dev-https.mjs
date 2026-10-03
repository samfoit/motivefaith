// `npm run dev:https` — the dev server over HTTPS, reachable from a phone.
//
// Browsers only expose the camera on a secure origin, and plain-http
// `localhost` stops counting once the page is opened from another device at
// the LAN IP. Next's own --experimental-https certificate only names
// localhost, so this mints one with mkcert that also names this machine's
// current LAN IP (regenerated every run, so a new IP just works).
//
// The phone has to trust mkcert's root CA once: `mkcert -CAROOT` prints where
// rootCA.pem lives; AirDrop or email it to the device and install it
// (on iOS, also enable it under Settings → General → About → Certificate
// Trust Settings).

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { networkInterfaces } from "node:os";

const lanIps = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === "IPv4" && !i.internal)
  .map((i) => i.address);

const KEY = "certificates/dev-key.pem";
const CERT = "certificates/dev-cert.pem";

mkdirSync("certificates", { recursive: true });

try {
  execFileSync(
    "mkcert",
    ["-key-file", KEY, "-cert-file", CERT, "localhost", "127.0.0.1", "::1", ...lanIps],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
} catch {
  console.error("mkcert failed. Install it with `brew install mkcert && mkcert -install`.");
  process.exit(1);
}

const next = spawn(
  "next",
  ["dev", "--experimental-https", "--experimental-https-key", KEY, "--experimental-https-cert", CERT, ...process.argv.slice(2)],
  { stdio: "inherit", shell: process.platform === "win32" },
);
next.on("exit", (code) => process.exit(code ?? 0));
