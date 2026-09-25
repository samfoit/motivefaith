import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The shared look for every link preview the app produces.
 *
 * Satori — what `next/og` renders with — supports TTF, OTF and WOFF, but not
 * WOFF2, which is the only format `next/font` leaves on disk. So the display
 * face is vendored here as a latin-subset TTF (48KB each) rather than fetched
 * from Google at render time: an OG image that depends on an outbound request
 * fails silently, and a link preview that fails is one nobody ever sees is
 * broken.
 *
 * Paths are string literals so Next's file tracing can find them; next.config
 * also names the directory in `outputFileTracingIncludes` as a belt to that
 * brace, because a missing font here is a runtime error, not a build one.
 */
const FONT_DIR = join(process.cwd(), "src/app/_fonts");

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

export async function ogFonts() {
  const [regular, bold] = await Promise.all([
    readFile(join(FONT_DIR, "DMSans-Regular.ttf")),
    readFile(join(FONT_DIR, "DMSans-Bold.ttf")),
  ]);

  return [
    { name: "DM Sans", data: regular, weight: 400 as const, style: "normal" as const },
    { name: "DM Sans", data: bold, weight: 700 as const, style: "normal" as const },
  ];
}

const INK = "#1c1917";
const MUTED = "#78716c";
const BRAND = "#6366f1";
const SUCCESS = "#22c55e";

/**
 * One card, two uses: a named invite and the app's own default preview.
 *
 * `headline` is the only thing that changes between them, which is deliberate
 * — a preview that looks like a different product depending on which link you
 * followed is a preview that does not build recognition.
 */
export function OgCard({
  headline,
  subhead,
  pill,
}: {
  headline: string;
  subhead: string;
  pill: string;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        background: "#fafaf9",
        backgroundImage:
          "radial-gradient(circle at 88% 8%, #eef2ff 0%, #fafaf9 58%)",
        fontFamily: "DM Sans",
      }}
    >
      {/* Wordmark */}
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: BRAND,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            fontSize: 32,
            fontWeight: 700,
          }}
        >
          M
        </div>
        <div style={{ fontSize: 28, color: MUTED, fontWeight: 700 }}>
          MotiveFaith
        </div>
      </div>

      {/* Message */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            color: INK,
            letterSpacing: -2.5,
            lineHeight: 1.05,
          }}
        >
          {headline}
        </div>
        <div
          style={{
            fontSize: 34,
            color: MUTED,
            marginTop: 22,
            lineHeight: 1.3,
            maxWidth: 820,
          }}
        >
          {subhead}
        </div>
      </div>

      {/* Footer: the call, and a week of kept days behind it — the product's
          own vocabulary, so the preview reads as this app and not as any
          invite card. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "16px 32px",
            borderRadius: 999,
            background: BRAND,
            color: "#ffffff",
            fontSize: 28,
            fontWeight: 700,
          }}
        >
          {pill}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              style={{
                width: 26,
                height: 26,
                borderRadius: 999,
                background: i < 5 ? SUCCESS : "#e7e5e4",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
