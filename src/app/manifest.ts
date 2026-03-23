import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MotiveFaith",
    short_name: "MotiveFaith",
    description: "Faith-driven accountability habit tracker",
    start_url: "/main/dashboard",
    display: "standalone",
    background_color: "#FAFAF9",
    theme_color: "#6366F1",
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
  };
}
