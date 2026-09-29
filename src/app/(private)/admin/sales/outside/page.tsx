import { redirect } from "next/navigation";
import { OUTSIDE_HREF } from "@/components/business/frame";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * The old Outside buyers address (before V6): it opens the same page under
 * the Ledger, keeping its search (`q`) and the buyer opened (`name`). The
 * page there checks the admin.
 */
export default async function OutsideBuyersRedirect({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const kept = new URLSearchParams();
  for (const key of ["q", "name"]) {
    const value = params[key];
    if (typeof value === "string") kept.set(key, value);
  }
  redirect(kept.size > 0 ? `${OUTSIDE_HREF}?${kept}` : OUTSIDE_HREF);
}
