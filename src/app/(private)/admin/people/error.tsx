"use client";

import { ScreenError } from "@/components/admin/states";

/** A11 / D8 · couldn't load: no stale list; no invitation was sent. */
export default function PeopleError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <ScreenError title="People" heading="Couldn't load people" error={error} retry={unstable_retry} back={{ href: "/admin/business", label: "Business" }} />;
}
