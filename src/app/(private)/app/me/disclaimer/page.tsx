import { ChevronLeft } from "lucide-react";
import Link from "@/components/alpha/link";
import { DisclaimerBox } from "@/components/auth/disclaimer";
import { CYCLES_MAIN } from "@/components/research/cycles/cycles-list";
import { requireResearcher } from "@/lib/auth/session";
import { formatDateTime12 } from "@/lib/format";
import { SUPPORT_TIME_ZONE } from "@/lib/support/view";
import { createClient } from "@/lib/supabase/server";

/**
 * R8 Account › Research-use disclaimer: R15 read-only, with when it was
 * accepted and which version (stored with the account).
 */
export default async function DisclaimerPage() {
  const person = await requireResearcher("/app/me/disclaimer");
  const db = await createClient();
  const { data } = await db.from("profiles").select("acknowledged_at, acknowledgement_version").eq("id", person.id).maybeSingle();

  return (
    <main className={CYCLES_MAIN}>
      <nav aria-label="Disclaimer" className="flex h-11 items-center pl-1.5 text-[17px] text-signal-ink laptop:hidden">
        <Link href="/app/me" className="flex h-11 items-center gap-0.5">
          <ChevronLeft className="size-[26px]" aria-hidden />
          Me
        </Link>
      </nav>
      <div className="px-5 pt-1 laptop:max-w-[640px] laptop:px-0 laptop:pt-0">
        <Link href="/app/me" className="hidden text-[14px] text-signal-ink laptop:block">
          ‹ Me
        </Link>
        <h1 className="mt-1 text-[34px] leading-[1.1] font-semibold tracking-[-0.03em]">For research use only</h1>
        {data?.acknowledged_at ? (
          <p className="mt-2.5 text-[15px] leading-[1.5] text-ink-2" data-testid="disclaimer-accepted">
            You agreed on {formatDateTime12(data.acknowledged_at, { timeZone: SUPPORT_TIME_ZONE })}.
            <span className="mt-0.5 block font-mono text-[12px] text-ink-3">Version {data.acknowledgement_version}</span>
          </p>
        ) : null}
      </div>
      <DisclaimerBox className="mx-3 mt-5 max-h-[60vh] laptop:mx-0 laptop:max-w-[640px]" />
    </main>
  );
}
