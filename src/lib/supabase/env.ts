// Supabase connection settings (browser-safe). The secret key is read only by
// ./admin.ts, which is server-only.

export function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set. See .env.example and README "Local development".`);
  return value;
}

export function supabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function supabasePublishableKey(): string {
  return required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
