import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";

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
    const cspReportUrl = process.env.CSP_REPORT_URL;
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
        // CSP is set dynamically by proxy.ts (nonce per request).
        // Only static security headers remain here.
        source: "/(.*)",
        headers: [
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
