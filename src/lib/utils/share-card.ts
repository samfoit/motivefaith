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
 * This is a poster, not a screen. It is seen by people who do not use the app,
 * at thumbnail size, next to photographs. The first version was laid out like
 * an app view — wordmark in one corner, URL in the other, off-white ground —
 * and an off-white card is invisible against a feed that is itself white.
 *
 * So: a deep violet ground, and the streak drawn as a field of marks rather
 * than stated as a number over a gradient. One mark per kept day. The count is
 * shown instead of announced, which is both the more arresting image at
 * thumbnail size and the one that belongs to this product rather than to any
 * stats card. The marks size themselves to the count, so a first day is a
 * single struck disc and a year is a fine mesh, and both fill the frame.
 *
 * Three elements: the field, one sentence, one address. There is no logo — the
 * address already says the name, and a wordmark on top of it was an accessory.
 */

export type CardFormat = "square" | "story";
export type CardTheme = "light" | "dark";

export interface StreakCardOptions {
  title: string;
  streak: number;
  /** "day" or "week" — habits can be scheduled either way. */
  unit: string;
  /** Sits at the foot of the card; the whole point of the exercise. */
  inviteUrl: string;
  format: CardFormat;
  theme: CardTheme;
}

const SIZES: Record<CardFormat, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
};

/**
 * Violet and gold rather than the product's interface indigo. The app's own
 * palette is built to sit behind text all day; this has to survive being two
 * inches wide between other people's photographs.
 */
const PALETTE = {
  dark: {
    ground: "#171334",
    groundEdge: "#0C0A1D",
    bloom: "#2A2065",
    mark: "#F6C445",
    ink: "#FFFFFF",
    inkSoft: "#9E96C8",
    address: "#F6C445",
  },
  light: {
    ground: "#F1EEFF",
    groundEdge: "#F1EEFF",
    bloom: "rgba(0,0,0,0)",
    mark: "#2E2472",
    ink: "#191338",
    inkSoft: "#6B6394",
    address: "#8A6A1F",
  },
} as const;

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
 * Canvas does not wait for webfonts. Drawing before they land produces a card
 * in the fallback face, and `toBlob` gives no second chance to repaint it.
 */
async function ensureFonts(family: string): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load(`400 64px ${family}`),
      document.fonts.load(`700 64px ${family}`),
    ]);
    await document.fonts.ready;
  } catch {
    // A card in the fallback face beats no card at all.
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

/**
 * Lay `count` marks into a box, as large as they can be while still fitting.
 *
 * The first version walked the column count upward and took the first
 * arrangement that fit. That does find the largest cell — but the largest cell
 * means the fewest rows, so the grid filled the width and left a pool of empty
 * ground beneath it. Six days rendered as one cramped line across the top of an
 * otherwise blank card.
 *
 * Choosing the column count from the box's own aspect ratio makes the grid the
 * shape of the space it is going into, so it fills rather than perches. The
 * cell is then taken as whichever of the two constraints binds, and capped so
 * that a streak of two is not two dinner plates.
 */
function fitGrid(
  count: number,
  boxWidth: number,
  boxHeight: number,
): { cols: number; rows: number; cell: number } {
  const ideal = Math.sqrt((count * boxWidth) / boxHeight);
  const cols = Math.max(1, Math.min(count, Math.round(ideal)));
  const rows = Math.ceil(count / cols);
  const cap = boxWidth / (count <= 4 ? 2.2 : 3.2);
  const cell = Math.min(boxWidth / cols, boxHeight / rows, cap);
  return { cols, rows, cell };
}

export async function renderStreakCard(
  options: StreakCardOptions,
): Promise<Blob> {
  const { width, height } = SIZES[options.format];
  const isStory = options.format === "story";
  const c = PALETTE[options.theme];
  const family = displayFamily();
  await ensureFonts(family);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable");

  const pad = 88;
  const inner = width - pad * 2;

  // --- Ground ------------------------------------------------------------
  const ground = ctx.createLinearGradient(0, 0, width * 0.35, height);
  ground.addColorStop(0, c.ground);
  ground.addColorStop(1, c.groundEdge);
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, width, height);

  // A single soft bloom behind the field, so the marks sit in light rather
  // than on a flat rectangle.
  const bloom = ctx.createRadialGradient(
    width * 0.72,
    height * (isStory ? 0.24 : 0.3),
    0,
    width * 0.72,
    height * (isStory ? 0.24 : 0.3),
    width * 0.85,
  );
  bloom.addColorStop(0, c.bloom);
  bloom.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = options.theme === "dark" ? 0.55 : 0;
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 1;

  // --- Text block, measured from the bottom up ---------------------------
  const headlineSize = isStory ? 92 : 76;
  const addressSize = isStory ? 34 : 30;
  const headline =
    options.streak > 0
      ? `${options.streak} ${options.streak === 1 ? options.unit : `${options.unit}s`} of ${options.title}`
      : `Starting ${options.title}`;

  ctx.font = `700 ${headlineSize}px ${family}`;
  const headlineLines = wrap(ctx, headline, inner, 3);
  const headlineLeading = headlineSize * 1.1;

  const addressBaseline = height - pad - (isStory ? 52 : 0);
  const headlineBottom = addressBaseline - addressSize - 46;
  const headlineTop = headlineBottom - headlineLines.length * headlineLeading;

  // --- The field ---------------------------------------------------------
  const fieldTop = pad;
  const fieldHeight = headlineTop - fieldTop - (isStory ? 96 : 72);
  const marks = Math.max(options.streak, 1);
  const { cols, rows, cell } = fitGrid(marks, inner, fieldHeight);
  const radius = cell * 0.345;

  // Centred in its box on both axes. Left-aligning it to agree with the
  // headline looked right only when the grid happened to fill the width; a
  // partial last row otherwise dragged the whole block off-balance.
  const gridLeft = pad + (inner - cols * cell) / 2;
  const gridTop = fieldTop + (fieldHeight - rows * cell) / 2;

  const lastRowCount = marks - (rows - 1) * cols;
  const lastRowInset = ((cols - lastRowCount) * cell) / 2;

  ctx.fillStyle = c.mark;
  for (let i = 0; i < marks; i++) {
    const row = Math.floor(i / cols);
    const inset = row === rows - 1 ? lastRowInset : 0;
    const cx = gridLeft + inset + (i % cols) * cell + cell / 2;
    const cy = gridTop + row * cell + cell / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    if (options.streak === 0) {
      // Nothing kept yet: an outline, so the card can still be sent on day one
      // without claiming a day that has not happened.
      ctx.lineWidth = Math.max(3, radius * 0.16);
      ctx.strokeStyle = c.mark;
      ctx.stroke();
    } else {
      ctx.fill();
    }
  }

  // --- Headline ----------------------------------------------------------
  ctx.fillStyle = c.ink;
  ctx.font = `700 ${headlineSize}px ${family}`;
  ctx.textBaseline = "alphabetic";
  headlineLines.forEach((line, i) => {
    ctx.fillText(line, pad, headlineTop + (i + 1) * headlineLeading - headlineLeading * 0.24);
  });

  // --- Address -----------------------------------------------------------
  ctx.fillStyle = c.address;
  ctx.font = `700 ${addressSize}px ${family}`;
  ctx.fillText(options.inviteUrl, pad, addressBaseline);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Could not render the card")),
      "image/png",
    );
  });
}
