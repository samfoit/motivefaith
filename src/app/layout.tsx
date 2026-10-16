import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Figtree, Newsreader, JetBrains_Mono } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import { Providers } from "@/components/providers";
import { THEME_INIT_SCRIPT } from "@/lib/theme-init-script";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

// Figtree and Newsreader are preloaded (next/font's default); JetBrains Mono is not.
//
// (The measurements below were taken with Inter and DM Sans, the faces before
// Lamplight. The reasoning holds for any pair of preloaded faces; re-measure
// per DIAGNOSIS.md R12 if the numbers matter.)
//
// This is a deliberate, measured choice — please don't "optimize" the preloads
// away without re-reading this.
//
// Dropping both preloads is genuinely faster to first paint. The two tags put
// 84KB of woff2 ahead of the 14KB render-blocking stylesheet, and on a
// throttled link those bytes saturate it: measured, the stylesheet started at
// 180ms and did not finish until 549ms, against ~70ms of transfer time.
// Removing them moved /main/dashboard from 712ms to 476ms FCP and LCP.
//
// It was still reverted, because of what it does to reported LCP on /main/feed.
// The largest element there is a body-text paragraph. It is laid out at its
// final size by 463ms and fully visible by 877ms either way — but Chrome
// re-stamps its LCP entry when the webfaces finish settling, so deferring the
// fonts pushed the *reported* number from 864ms to 1652ms even though nothing
// visible changed. Core Web Vitals is what gets measured in the field, so the
// reported number wins.
//
// Preloading Inter alone does NOT fix it (feed LCP 1632ms — unchanged) while
// still costing 164ms of first paint; the stamp tracks all faces settling, not
// just the one the text uses. Both faces have to be preloaded together.
// JetBrains Mono is stat numerals only and lands late without affecting it.
//
// Full working, including the eight experiments that ruled out the font swap,
// opacity gating, DOM replacement and main-thread stalls: DIAGNOSIS.md R12/R13.
const figtree = Figtree({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

// Headings: a book serif with an optical-size axis, so a 24px greeting and a
// 13px label each get the cut drawn for them.
const newsreader = Newsreader({
  variable: "--font-display",
  subsets: ["latin"],
  // Variable weight: next/font allows extra axes only on the variable cut.
  axes: ["opsz"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    // The pinned Lamplight header colors. In "Auto" mode the theme store
    // rewrites these to the hour's header once the page hydrates.
    { media: "(prefers-color-scheme: light)", color: "#D3E5F3" },
    { media: "(prefers-color-scheme: dark)", color: "#12151F" },
  ],
};

/**
 * Absolute base for every generated OG URL. Without it Next emits relative
 * image paths, which crawlers cannot resolve — the preview silently falls back
 * to no image at all. VERCEL_URL covers preview deploys, where the host is not
 * known until build time.
 */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: "MotiveFaith",
  description: "Faith-driven accountability habit tracker",
  // The image itself comes from `opengraph-image.tsx` alongside this file;
  // Next wires it into both cards, so neither names a URL here.
  openGraph: {
    type: "website",
    siteName: "MotiveFaith",
    title: "MotiveFaith",
    description:
      "Keep the habits that matter, with people who keep you honest.",
  },
  twitter: {
    card: "summary_large_image",
    title: "MotiveFaith",
    description:
      "Keep the habits that matter, with people who keep you honest.",
  },
  icons: {
    icon: [
      { url: "/icon-lamp-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-lamp-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon-lamp.png",
  },
};

/**
 * Reads `headers()` purely to get the per-request CSP nonce for the inline
 * theme script. That makes every route render on demand, which is a real cost
 * — but a nonce-based CSP and static prerendering are mutually exclusive:
 * removing this read makes the routes static, and Next.js's own inline RSC
 * bootstrap scripts then have no nonce and are blocked by `script-src`.
 * Verified by measurement; see DIAGNOSIS.md / "Techniques rejected".
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") ?? "";

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        {process.env.NEXT_PUBLIC_SUPABASE_URL && (
          <link
            rel="preconnect"
            href={process.env.NEXT_PUBLIC_SUPABASE_URL}
          />
        )}
        <link
          rel="dns-prefetch"
          href="https://challenges.cloudflare.com"
        />
        {/*
          Theme-init script: prevents flash-of-wrong-theme on page load.
          A hardcoded string literal — no user input is interpolated.
          Protected by CSP script-src via the nonce generated in proxy.ts.
        */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
      </head>
      <body
        className={`${figtree.variable} ${newsreader.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <Providers>
          <ToastProvider>{children}</ToastProvider>
        </Providers>
        {/* Production only. In dev both load a debug script from
            va.vercel-scripts.com, which the dev CSP (src/proxy.ts) blocks —
            and they record nothing in dev anyway. In production they load
            from /_vercel/, which 'self' already allows. */}
        {process.env.NODE_ENV === "production" && (
          <>
            <SpeedInsights />
            <Analytics />
          </>
        )}
      </body>
    </html>
  );
}
