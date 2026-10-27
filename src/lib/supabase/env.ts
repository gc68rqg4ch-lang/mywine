export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL und NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY müssen gesetzt sein.",
  );
}
