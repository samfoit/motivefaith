import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";

/**
 * SHA-256 hash of the inline theme-init script in layout.tsx.
 *
 * SECURITY: This hash pins the exact script content in CSP script-src.
 * If you change the script in layout.tsx you MUST regenerate this hash:
 *   echo -n '<script content>' | openssl dgst -sha256 -binary | openssl base64
 * Then update both this constant and verify the CSP still blocks
 * any other inline scripts.
 */
const THEME_SCRIPT_HASH = "sha256-1UqXuCYkuQsrbl9xmaTZQlPIyOW9nIWl7pVXp4riiXU=";

const supabaseHostname = (() => {
  try {
    const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return raw ? new URL(raw).hostname : null;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  ...(process.env.NODE_ENV === "development" &&
    process.env.DEV_ORIGIN && {
      allowedDevOrigins: [process.env.DEV_ORIGIN],
    }),
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns", "motion/react"],
  },
  images: {
    remotePatterns: [
      ...(supabaseHostname
        ? [{ protocol: "https" as const, hostname: supabaseHostname }]
        : []),
      {
        protocol: "http",
        hostname: "127.0.0.1",
        port: "54321",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  headers: async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL)
      : null;
    const supabaseHost = supabaseUrl?.host ?? "*.supabase.co";
    const supabaseIsSecure = supabaseUrl ? supabaseUrl.protocol === "https:" : true;
    const httpProto = supabaseIsSecure ? "https:" : "http:";
    const wsProto = supabaseIsSecure ? "wss:" : "ws:";

    const isDev =
      process.env.NODE_ENV === "development" &&
      process.env.VERCEL_ENV === undefined;

    const cspReportUrl = process.env.CSP_REPORT_URL;

    const csp = [
      "default-src 'self'",
      isDev
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com"
        : `script-src 'self' '${THEME_SCRIPT_HASH}' https://challenges.cloudflare.com`,
      // style-src 'unsafe-inline' is required by Radix UI primitives and
      // motion (Framer Motion) which inject inline styles for positioning
      // and animations. script-src blocks inline script execution, so
      // style injection alone is not exploitable without a separate XSS
      // vector. Revisit when Radix UI supports CSP nonces for styles.
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      `connect-src 'self' ${httpProto}//${supabaseHost} ${wsProto}//${supabaseHost}`,
      "font-src 'self' https://fonts.gstatic.com",
      `img-src 'self' data: blob: ${httpProto}//${supabaseHost}`,
      `media-src 'self' blob: ${httpProto}//${supabaseHost}`,
      "frame-src https://challenges.cloudflare.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      ...(isDev ? [] : ["upgrade-insecure-requests"]),
      ...(cspReportUrl ? [`report-uri ${cspReportUrl}`, `report-to csp-endpoint`] : []),
    ].join("; ");

    const reportToHeader = cspReportUrl
      ? JSON.stringify({ group: "csp-endpoint", max_age: 86400, endpoints: [{ url: cspReportUrl }] })
      : null;

    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/icon-:size.png",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/icon-maskable.png",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "geolocation=(), microphone=(), camera=(self)",
          },
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          ...(reportToHeader
            ? [{ key: "Report-To", value: reportToHeader }]
            : []),
        ],
      },
    ];
  },
};

const analyzer = withBundleAnalyzer({ enabled: process.env.ANALYZE === "true" });

export default analyzer(nextConfig);
