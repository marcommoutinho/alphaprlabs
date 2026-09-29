import { redirect } from "next/navigation";

/** Researcher support is part of A11 / D8 People (V7): the old address redirects. */
export default function OldSupportPage() {
  redirect("/admin/people");
}
