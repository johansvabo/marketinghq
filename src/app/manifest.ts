import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Marketing HQ",
    short_name: "HQ",
    description: "Client work, marketing data, captured thinking and what needs to happen next — in one place.",
    start_url: "/",
    display: "standalone",
    background_color: "#101116",
    theme_color: "#101116",
    orientation: "portrait-primary",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
    shortcuts: [
      { name: "Today", url: "/" },
      { name: "Ask the brain", url: "/brain" },
      { name: "Capture", url: "/brain/new" },
    ],
  };
}
