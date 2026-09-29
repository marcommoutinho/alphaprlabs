"use client";

import { PaneError } from "@/components/admin/states";

/** A9 / D6 editor · couldn't load: the list beside it stays. */
export default function PeptideError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <PaneError heading="Couldn't load this peptide" error={error} retry={unstable_retry} back={{ href: "/admin/library", label: "Library" }} />;
}
