import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Contraflow",
    short_name: "Contraflow",
    description: "Net loops of debt. No cash moves.",
    start_url: "/",
    display: "standalone",
    background_color: "#08090f",
    theme_color: "#08090f",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
