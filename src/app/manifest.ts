import type { MetadataRoute } from "next";

// Web-App-Manifest: Name und Symbol „Traube“ für Home-Bildschirm und Lesezeichen.
// display „browser“ (nicht standalone): Eine Home-Bildschirm-App hätte auf iOS eine eigene
// Sitzung – der Magic Link aus der E-Mail öffnet sich in Safari, das Login käme dort nicht an.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MyWine",
    short_name: "MyWine",
    description: "Persönliche Weinsammlung",
    start_url: "/",
    display: "browser",
    background_color: "#faf7f5",
    theme_color: "#faf7f5",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
