/**
 * How a vial is named in text. A label of the researcher's own ("A-02")
 * reads "Vial A-02" (R7), or "vial A-02" inside a sentence. A label that
 * already says it is a vial is its own name: the database names a vial added
 * without a label "Vial 3" (add_personal_vial), which reads "Vial 3", never
 * "Vial Vial 3". Pure, for the server and the client.
 */
export function vialName(label: string, inSentence = false): string {
  if (/^vial\b/i.test(label)) return inSentence ? label : label.charAt(0).toUpperCase() + label.slice(1);
  return `${inSentence ? "vial" : "Vial"} ${label}`;
}
