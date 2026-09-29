import { redirect } from "next/navigation";

type Params = Promise<{ researcherId: string }>;

/** A researcher's shared history is A12 under People (V7): the old address redirects. */
export default async function OldResearcherHistoryPage({ params }: { params: Params }) {
  const { researcherId } = await params;
  redirect(`/admin/people/${encodeURIComponent(researcherId)}`);
}
