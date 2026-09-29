import { EditorSkeleton } from "@/components/admin/states";

/** A9 / D6 editor · loading: the editor's frame with fields at real size; the list beside it stays. */
export default function PeptideLoading() {
  return <EditorSkeleton label="Loading the peptide" />;
}
