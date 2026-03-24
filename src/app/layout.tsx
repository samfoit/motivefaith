import type { Metadata, Viewport } from "next";
import { Inter, DM_Sans, JetBrains_Mono } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import { Providers } from "@/components/providers";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-display",
  subsets: ["latin"],
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
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a1e" },
  ],
};

export const metadata: Metadata = {
  title: "MotiveFaith",
  description: "Faith-driven accountability habit tracker",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
          This is a hardcoded string literal — no user input is interpolated.
          Protected by CSP script-src via THEME_SCRIPT_HASH in next.config.ts.
          If you change this script content you MUST update the hash constant.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("motive-theme");var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme:dark)").matches);if(d)document.documentElement.setAttribute("data-theme","dark")}catch(e){}})()`,
          }}
        />
      </head>
      <body
        className={`${inter.variable} ${dmSans.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <Providers>
          <ToastProvider>{children}</ToastProvider>
        </Providers>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
