import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { required, supabaseUrl } from "./env";

/**
 * Secret-key client: bypasses Row Level Security. Only for the narrow,
 * server-side operations that cannot run as the requester (look up an
 * invitation by token hash, create the account on acceptance). Never use it to
 * decide what a signed-in person may see.
 */
export function createAdminClient() {
  return createClient<Database>(supabaseUrl(), required("SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export type AdminClient = ReturnType<typeof createAdminClient>;
