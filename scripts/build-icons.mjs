/**
 * Regenerates the app's raster icons from the two SVG sources in public/.
 *
 *   node scripts/build-icons.mjs
 *
 * The PNG names carry the design ("lamp"), not just a size, on purpose:
 * next.config.ts serves /icon-*.png as immutable for a year, so a new design
 * at an old URL would never reach a browser that has the old one. A future
 * redesign gets new names too — and the manifest, the root layout and the
 * service worker's SHELL_ROUTES and notification icon follow them.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = (name) => join(root, "public", name);

const icon = await readFile(pub("icon.svg"));
const maskable = await readFile(pub("icon-maskable.svg"));
// iOS rounds the corners itself and keeps far more of the square than
// Android's maskable safe zone, so the mark can sit larger there.
const appleTouch = Buffer.from(
  maskable.toString().replace("scale(0.7)", "scale(0.84)"),
);

function png(svg, size) {
  return sharp(svg, { density: 72 * (size / 512) * 4 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * An .ico is a small directory of images; modern browsers accept PNG entries,
 * so each size is a PNG wrapped in the ICONDIR / ICONDIRENTRY headers.
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // no palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const outputs = [
  ["public/icon-lamp-192.png", await png(icon, 192)],
  ["public/icon-lamp-512.png", await png(icon, 512)],
  ["public/icon-lamp-maskable.png", await png(maskable, 512)],
  // Opaque and full bleed: iOS fills transparent corners with black.
  ["public/apple-touch-icon-lamp.png", await png(appleTouch, 180)],
  [
    "src/app/favicon.ico",
    ico(
      await Promise.all(
        [16, 32, 48].map(async (size) => ({ size, data: await png(icon, size) })),
      ),
    ),
  ],
];

for (const [path, data] of outputs) {
  await writeFile(join(root, path), data);
  console.warn(`wrote ${path} (${data.length} bytes)`);
}
