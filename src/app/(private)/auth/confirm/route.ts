import { NextResponse, type NextRequest } from "next/server";
import { RECOVER_PATH, RESET_PASSWORD_PATH } from "@/lib/auth/paths";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing for the recovery email link (supabase/templates/recovery.html):
 * verifies the one-time token hash, which signs the person in, then asks for a
 * new password. A used or expired link goes back to Recover access.
 */
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");

  if (tokenHash && type === "recovery") {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(RESET_PASSWORD_PATH, request.url));
  }
  return NextResponse.redirect(new URL(`${RECOVER_PATH}?link=invalid`, request.url));
}
