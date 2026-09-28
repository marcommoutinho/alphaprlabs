import { cookies } from "next/headers";
import { DesignGallery } from "@/components/alpha/gallery/design-gallery";
import { APPEARANCE_COOKIE, parseAppearance } from "@/lib/alpha/appearance";
import { requireAdmin } from "@/lib/auth/session";

export const metadata = { title: "Components · Alpha PR Labs" };

/**
 * Design v3 component gallery (V0), for admins only: every foundation
 * component in light and dark, so later slices and reviewers can check them.
 * Not linked from the navigation; open /admin/design.
 */
export default async function DesignGalleryPage() {
  await requireAdmin("/admin/design");
  const appearance = parseAppearance((await cookies()).get(APPEARANCE_COOKIE)?.value);
  return <DesignGallery appearance={appearance} />;
}
