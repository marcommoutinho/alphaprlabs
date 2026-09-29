import { redirect } from "next/navigation";

/** Invitations are part of A11 / D8 People (V7): the old address redirects. */
export default function OldInvitationsPage() {
  redirect("/admin/people");
}
