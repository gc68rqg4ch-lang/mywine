import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { ZoomReset } from "@/components/zoom-reset";
import { AuthUrlCleanup } from "@/components/auth-url-cleanup";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "MyWine", template: "%s · MyWine" },
  description: "Persönliche Weinsammlung",
  applicationName: "MyWine",
  // Name auf dem Home-Bildschirm (nicht der Seitentitel). Bewusst nicht über appleWebApp: das setzt
  // „mobile-web-app-capable“ – eine Home-Bildschirm-App hätte eine eigene Sitzung, der Magic Link käme
  // nicht an (siehe manifest.ts, display „browser“).
  other: { "apple-mobile-web-app-title": "MyWine" },
};

// iPad/iPhone: kein automatisches Hineinzoomen beim Antippen von Feldern (maximum-scale=1);
// Zoomen mit zwei Fingern bleibt in Safari möglich – deshalb kein userScalable: false.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#17110f" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="de-CH" className={geistSans.variable}>
      <body>
        {children}
        {/* Hineingezoomt aus dem Zwischenspeicher zurück: auf Zoomstufe 1 (alle Seiten). */}
        <ZoomReset />
        {/* Abgelaufener Login-Link (#error=… bzw. ?error=…): aus der Adresse entfernen. */}
        <AuthUrlCleanup />
      </body>
    </html>
  );
}
