import { redirect } from "next/navigation";

/** A10 Templates moved under the Library (V7): the old address redirects. */
export default function OldTemplatesPage() {
  redirect("/admin/library/templates");
}
