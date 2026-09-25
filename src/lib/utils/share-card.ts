/**
 * Draws a shareable streak card on a canvas and hands back a PNG.
 *
 * Client-side on purpose. The server could render this with `next/og`, but only
 * by being able to read the habit — which would mean a public route serving
 * habit titles to anyone holding a URL. Habits here are prayer, scripture and
 * confession. The card is drawn on the device that already has the data, and
 * the only thing that leaves is the image the user chose to send.
 *
 * Nobody but the sharer appears on it. A habit with partners says nothing about
 * them: their names are not the sharer's to post.
 *
 * ── The design ──────────────────────────────────────────────────────────────
 *
 * This is a poster seen by people who do not use the app, at thumbnail size,
 * next to photographs. Two earlier attempts missed for the same reason: they
 * were laid out like app views. The first put a wordmark in one corner and a
 * URL in the other on an off-white ground, which is invisible against a feed
 * that is itself white. The second drew the streak as a grid of marks — one
 * per kept day — which is a unit chart, an analytics primitive that carries no
 * identity and reads as a chart rather than as something anyone would post.
 *
 * What the cards people actually share have in common is that the hero is
 * either the user's own content (a route, an album) or a mark the product has
 * made its own. So the numeral itself is the image here: set enormous in a
 * high-contrast serif, cropped hard by the right edge, gold on deep violet. It
 * is legible as a shape before it is legible as a number, which is what has to
 * be true at the size a card is first seen.
 *
 * A photo is offered but never required. Someone who does not know what to
 * photograph still gets a finished card, which is the whole reason the default
 * has to stand on its own.
 */

export type CardFormat = "square" | "story";
export type CardTheme = "light" | "dark";
/** How a supplied photo is used. `default` ignores any photo. */
export type CardLayout = "default" | "bleed" | "inset";

export interface StreakCardOptions {
  title: string;
  streak: number;
  /** "day" or "week" — habits can be scheduled either way. */
  unit: string;
  /** Sits at the foot of the card; the whole point of the exercise. */
  inviteUrl: string;
  format: CardFormat;
  theme: CardTheme;
  layout: CardLayout;
  /** Already loaded and decoded by the caller, so drawing stays synchronous. */
  photo?: HTMLImageElement | null;
}

const SIZES: Record<CardFormat, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
};

/**
 * Violet and gold rather than the product's interface indigo. The app's palette
 * is built to sit behind text all day; this has to survive being two inches
 * wide between other people's photographs.
 */
const PALETTE = {
  dark: {
    from: "#3A1F6B",
    mid: "#1B1038",
    to: "#120B28",
    numeral: "#F4B63F",
    ink: "#FFFFFF",
    inkSoft: "#C3B6F0",
    address: "#F4B63F",
    scrim: "10,6,26",
  },
  light: {
    from: "#F3EFFF",
    mid: "#E7DFFB",
    to: "#DCD1F5",
    numeral: "#4B2E9C",
    ink: "#1A1038",
    inkSoft: "#6B5B9E",
    address: "#8A5A12",
    scrim: "26,16,56",
  },
} as const;

const SERIF = "MotiveShareSerif";
let serifPromise: Promise<void> | null = null;

/**
 * The display serif is loaded on demand rather than through `next/font`.
 *
 * It exists for this one card, and routing it through the app's font pipeline
 * would put it in the critical path of every page for the sake of a sheet most
 * sessions never open. Loaded here, it costs 62KB the first time somebody taps
 * share and nothing at all otherwise.
 */
function loadSerif(): Promise<void> {
  if (serifPromise) return serifPromise;
  serifPromise = (async () => {
    if (typeof document === "undefined" || !("FontFace" in window)) return;
    try {
      const face = new FontFace(SERIF, 'url(/fonts/InstrumentSerif.ttf) format("truetype")');
      await face.load();
      document.fonts.add(face);
    } catch {
      // Falls back to the sans below. A card in the wrong face beats no card.
      serifPromise = null;
    }
  })();
  return serifPromise;
}

function displayFamily(): string {
  if (typeof document === "undefined") return "sans-serif";
  const probe = document.createElement("span");
  probe.style.fontFamily = "var(--font-display)";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).fontFamily;
  probe.remove();
  return resolved || "sans-serif";
}

/**
 * Canvas does not wait for webfonts, and `toBlob` gives no second chance to
 * repaint, so everything the card draws with is resolved before it starts.
 */
async function ensureFonts(family: string): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  await loadSerif();
  try {
    await Promise.all([
      document.fonts.load(`400 64px ${family}`),
      document.fonts.load(`700 64px ${family}`),
      document.fonts.load(`400 200px "${SERIF}"`),
    ]);
    await document.fonts.ready;
  } catch {
    // As above.
  }
}

/** Greedy wrap, capped — a long title must not run off its own edge. */
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);

  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    if (ctx.measureText(last).width > maxWidth) {
      while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[maxLines - 1] = `${last}…`;
    }
  }
  return lines;
}

/** Cover-fit: fill the box, crop the overflow, never distort. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function renderStreakCard(
  options: StreakCardOptions,
): Promise<Blob> {
  const { width, height } = SIZES[options.format];
  const isStory = options.format === "story";
  const c = PALETTE[options.theme];
  const family = displayFamily();
  await ensureFonts(family);

  const usePhoto = options.layout !== "default" && !!options.photo;
  const layout = usePhoto ? options.layout : "default";

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable");

  const pad = isStory ? 92 : 84;
  const inner = width - pad * 2;

  // --- Ground ------------------------------------------------------------
  const ground = ctx.createLinearGradient(0, 0, width * 0.8, height);
  ground.addColorStop(0, c.from);
  ground.addColorStop(0.58, c.mid);
  ground.addColorStop(1, c.to);
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, width, height);

  // --- Type sizes --------------------------------------------------------
  const titleSize = isStory ? 104 : 88;
  const eyebrowSize = isStory ? 46 : 40;
  const addressSize = isStory ? 34 : 30;
  const titleLeading = titleSize * 1.05;

  ctx.font = `700 ${titleSize}px ${family}`;
  const titleLines = wrap(ctx, options.title, inner, 2);

  const unitLabel =
    options.streak === 1 ? `consecutive ${options.unit}` : `consecutive ${options.unit}s`;
  const eyebrow = options.streak > 0 ? unitLabel : "starting today";

  // The foot of the card is laid out from the bottom up in every layout, so
  // the address always lands the same distance from the edge.
  const addressBaseline = height - pad;
  const titleBottom = addressBaseline - addressSize - (isStory ? 52 : 44);
  const titleTop = titleBottom - titleLines.length * titleLeading;
  const eyebrowBaseline = titleTop - (isStory ? 18 : 14);

  // --- Photo layouts -----------------------------------------------------
  if (layout === "bleed" && options.photo) {
    drawCover(ctx, options.photo, 0, 0, width, height);

    // The scrim is the whole reason this layout is safe. A bright photo would
    // otherwise swallow white text, and there is no predicting what anyone
    // photographs, so it runs to near-opaque at the foot rather than to a
    // tasteful 70%.
    const scrimTop = eyebrowBaseline - eyebrowSize * 2.6;
    const scrim = ctx.createLinearGradient(0, scrimTop, 0, height);
    scrim.addColorStop(0, `rgba(${c.scrim},0)`);
    scrim.addColorStop(0.45, `rgba(${c.scrim},0.78)`);
    scrim.addColorStop(1, `rgba(${c.scrim},0.97)`);
    ctx.fillStyle = scrim;
    ctx.fillRect(0, scrimTop, width, height - scrimTop);
  } else if (layout === "inset" && options.photo) {
    // The type sits on solid ground beneath the window rather than on the
    // image, so no photo can make it unreadable.
    const windowTop = pad;
    const windowBottom = eyebrowBaseline - eyebrowSize * 2.2;
    roundRectPath(ctx, pad, windowTop, inner, windowBottom - windowTop, 12);
    ctx.save();
    ctx.clip();
    drawCover(ctx, options.photo, pad, windowTop, inner, windowBottom - windowTop);
    ctx.restore();
  } else {
    // --- The default: the numeral as the image ---------------------------
    // Set enormous, in the serif, and fully visible.
    //
    // It was cropped by the right and top edges at first — bleeding a numeral
    // off the frame is a real editorial device and it looked striking on a
    // "47". It was still wrong. The number is the message, and a card whose
    // message you cannot read says nothing. Worse, the failure was not even
    // uniform: this face carries the 7's crossbar in the top sixth of the
    // glyph, so a twelve per cent top crop turned every 7 into a bare
    // diagonal, and 5s and 3s went the same way. Scale and colour carry the
    // weight instead.
    const numeralText = String(Math.max(options.streak, 0));
    const probeSize = 200;
    ctx.textBaseline = "alphabetic";
    ctx.font = `400 ${probeSize}px "${SERIF}", ${family}`;
    const probe = ctx.measureText(numeralText);
    const probeHeight =
      probe.actualBoundingBoxAscent + probe.actualBoundingBoxDescent;
    const probeWidth = probe.actualBoundingBoxLeft + probe.actualBoundingBoxRight;

    // Height sets the scale so that "7" and "365" read at the same weight;
    // width then claws it back if three digits would otherwise overrun the
    // margins.
    const targetHeight = height * (isStory ? 0.36 : 0.5);
    let numeralSize = probeHeight
      ? probeSize * (targetHeight / probeHeight)
      : targetHeight;
    if (probeWidth) {
      const widthLimited = probeSize * (inner / probeWidth);
      numeralSize = Math.min(numeralSize, widthLimited);
    }

    ctx.font = `400 ${numeralSize}px "${SERIF}", ${family}`;
    const m = ctx.measureText(numeralText);

    // Ranged right against the margin, with the name ranged left at the foot:
    // the two corners pull the eye across the card.
    ctx.fillStyle = c.numeral;
    // A story is nearly twice as tall for the same content. Pinned to the top
    // margin like the square, the numeral left a corridor of empty ground
    // through the middle of the card; dropped to just under a fifth of the
    // height it sits in the band people actually look at, clear of the
    // platform's own chrome at both ends.
    const numeralTop = isStory ? height * 0.17 : pad;
    ctx.fillText(
      numeralText,
      width - pad - m.actualBoundingBoxRight,
      numeralTop + m.actualBoundingBoxAscent,
    );
  }

  // --- Foot --------------------------------------------------------------
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = usePhoto ? "rgba(255,255,255,0.82)" : c.inkSoft;
  ctx.font = `400 ${eyebrowSize}px ${family}`;
  ctx.fillText(eyebrow, pad, eyebrowBaseline);

  ctx.fillStyle = usePhoto ? "#FFFFFF" : c.ink;
  ctx.font = `700 ${titleSize}px ${family}`;
  titleLines.forEach((line, i) => {
    ctx.fillText(line, pad, titleTop + (i + 1) * titleLeading - titleLeading * 0.2);
  });

  ctx.fillStyle = usePhoto ? "rgba(255,255,255,0.7)" : c.address;
  ctx.font = `700 ${addressSize}px ${family}`;
  ctx.fillText(options.inviteUrl, pad, addressBaseline);

  // A photo layout still has to say the number somewhere, and the foot is
  // already carrying the name. It goes at the top, out of the type's way.
  if (usePhoto && options.streak > 0) {
    const badgeSize = isStory ? 210 : 180;
    ctx.font = `400 ${badgeSize}px "${SERIF}", ${family}`;
    ctx.textBaseline = "top";
    ctx.fillStyle = c.numeral;
    const text = String(options.streak);
    const w = ctx.measureText(text).width;
    ctx.fillText(text, width - pad - w, pad - badgeSize * 0.06);
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Could not render the card")),
      "image/png",
    );
  });
}
