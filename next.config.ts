import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Alle Seiten hängen an der Supabase-Session (Cookies) und werden
  // pro Request gerendert – Cache Components bringen hier nichts.
  cacheComponents: false,
};

export default nextConfig;
