import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MotiveFaith",
    short_name: "MotiveFaith",
    description: "Faith-driven accountability habit tracker",
    id: "/main/dashboard",
    start_url: "/main/dashboard",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    // Must match the app's real painted background so the splash screen
    // flows into the app instead of flashing a different color.
    // `--color-bg-primary` light = #fafaf9 (src/styles/tokens.css), and the
    // inline theme-init script in the root layout paints the same value.
    // Browsers may substitute a dark equivalent for prefers-color-scheme:dark;
    // the manifest format has no dark variant of its own.
    background_color: "#fafaf9",
    // Matches <meta name="theme-color"> in the document head, so the status
    // bar color does not change between splash and app.
    theme_color: "#fafaf9",
    categories: ["lifestyle", "health", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Dashboard",
        url: "/main/dashboard",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "New Habit",
        url: "/main/habits/new",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
