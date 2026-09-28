import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { referrer: "no-referrer" };

type Params = Promise<{ token: string }>;

/**
 * The earlier "Set up your access" step: R14 now asks for the password on
 * the invitation page itself, so an old link lands there.
 */
export default async function AccountSetupPage({ params }: { params: Params }) {
  const { token } = await params;
  redirect(`/auth/invite/${encodeURIComponent(token)}`);
}
