import { PublicNotFoundContent } from "@/components/not-found-content";

// notFound() on a public page (e.g. an unknown peptide): the public layout
// adds the header and footer around it.
export default function NotFound() {
  return <PublicNotFoundContent />;
}
