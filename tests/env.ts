// Umgebung für alle Tests: Platzhalter statt echter Schlüssel – Netzverkehr läuft über die
// Fakes (stub-net.ts bzw. fake-db.ts). Als erstes importieren, vor allem aus src/.
Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: "https://stub.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "stub",
  NEXT_PUBLIC_SITE_URL: "https://mywine.example",
  SUPABASE_SECRET_KEY: "stub",
  TELEGRAM_BOT_TOKEN: "stub",
  TELEGRAM_WEBHOOK_SECRET: "stub",
  TELEGRAM_ALLOWED_USER_ID: "111",
  ANTHROPIC_API_KEY: "stub",
});
