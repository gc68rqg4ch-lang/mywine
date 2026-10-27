import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Alle Seiten hängen an der Supabase-Session (Cookies) und werden
  // pro Request gerendert – Cache Components bringen hier nichts.
  cacheComponents: false,
  experimental: {
    serverActions: {
      // Foto-Upload auf der Weinseite: der Browser verkleinert vorher auf ca. 2000 px
      // (meist < 1.5 MB); Vercel nimmt höchstens 4.5 MB pro Request an.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
