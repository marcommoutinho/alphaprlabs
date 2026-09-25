import "server-only";
import { createClient } from "@supabase/supabase-js";
import { normalizeEmail } from "@/lib/invitations/state";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";

export type RecoveryDeps = {
  /** App origin for the emailed link (…/auth/confirm). */
  origin: string;
  /** Runs work after the response is sent (Next.js `after`). */
  schedule: (task: () => Promise<void>) => void;
  /** Asks the provider to email a recovery link; resolves to an error code or null. */
  send?: (email: string, redirectTo: string) => Promise<string | null>;
};

/**
 * Supabase Auth recovery request. It persists a token and sends mail only for
 * existing accounts. A cookie-less client: the emailed link carries a token
 * hash verified on /auth/confirm, so it works on any device (no PKCE cookie).
 */
export async function sendRecoveryEmail(email: string, redirectTo: string): Promise<string | null> {
  const supabase = createClient(supabaseUrl(), supabasePublishableKey(), {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  return error ? (error.code ?? String(error.status ?? "unknown")) : null;
}

/**
 * Validates the address and schedules the provider call for after the
 * response. Synchronous on purpose: the answer is the same, and returned at
 * the same speed, whether or not the email has an account.
 */
export function startRecovery(
  input: { email: unknown },
  { origin, schedule, send = sendRecoveryEmail }: RecoveryDeps,
): { sent: true } | { toast: string } {
  const email = normalizeEmail(input.email);
  if (!email) return { toast: "Enter a valid email address." };

  schedule(async () => {
    try {
      const code = await send(email, `${origin}/auth/confirm`);
      if (code) console.error("Recovery email request failed:", code);
    } catch {
      console.error("Recovery email request failed:", "exception");
    }
  });
  return { sent: true };
}
