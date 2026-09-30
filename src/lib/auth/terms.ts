// The research terms and the template notices (Marco, 2026-09-30), word for
// word as approved: change nothing here without new approved wording. A
// change to TERMS_SECTIONS is a new ACKNOWLEDGEMENT_VERSION
// (src/lib/auth/paths.ts) and a new public.current_terms_version() in a
// migration, so everyone agrees again.

/** R15's title, and the Me row and page title. */
export const TERMS_HEADING = "Research terms";
export const TERMS_ME_LINK = "Research terms";

/** R15's lead when joining. */
export const TERMS_LEAD = "Your agreement to these terms will be recorded with your account.";

/** R15's lead for someone who agreed to an earlier version. */
export const TERMS_UPDATED_LEAD = "You must accept the updated terms before continuing, and your agreement will be recorded with your account.";

/** R15's checkbox label. */
export const TERMS_CHECKBOX = "I am a researcher using this app for my own research, and I have read and accept these terms.";

/** The terms: each section's bold title, then its sentences. */
export const TERMS_SECTIONS: readonly { title: string; body: string }[] = [
  {
    title: "Research use only.",
    body: "Compounds are research materials, not supplied as drugs, food, supplements or cosmetics. They are not approved by Health Canada or the U.S. FDA. They are not sold to diagnose, treat, cure or prevent any condition.",
  },
  {
    title: "Who can use the app.",
    body: "The app is for invited researchers to record their own research. You must be at least 18 and have reached the age of majority where you live.",
  },
  {
    title: "What the app is.",
    body: "The app is a private tool for keeping your own research records. Its library, templates, calculator results and all other content are general reference information, not medical advice, instructions or a recommendation to use any compound. Alpha PR Labs never advises on, directs, supervises or approves anyone’s research.",
  },
  {
    title: "Cycle templates.",
    body: "Templates are general reference examples compiled from published research and online researcher discussions. Neither Alpha PR Labs nor any medical professional has clinically tested or verified them. They may be inaccurate, incomplete or outdated. They are not a protocol, prescription, instruction or recommendation for anyone. They say nothing about whether any use is safe or suitable for you. Starting a cycle from a template creates your own private copy. You alone decide whether to use it and what to change. Alpha PR Labs may change or withdraw templates anytime without changing cycles already made from them.",
  },
  {
    title: "Your responsibility.",
    body: "You alone decide and are responsible for your research, plans, amounts and schedules. Check every number, including calculator results, which depend on your inputs. You are responsible for safe handling, storage and following all applicable laws and regulations where you are located.",
  },
  {
    title: "Health.",
    body: "Talk to a qualified healthcare provider before making health decisions. In an emergency, call 911 or your local emergency number.",
  },
  {
    title: "Risk and liability.",
    body: 'Use compounds and the app at your own risk. To the fullest extent permitted by law, the app and content are provided "as is", without warranties of accuracy, completeness or fitness for any purpose. To the fullest extent permitted by law, Alpha PR Labs is not liable for injury, loss or damage from compounds, the app or content, and you agree to indemnify Alpha PR Labs against claims from your use or misuse of compounds, the app or content.',
  },
  {
    title: "Privacy.",
    body: "Only you can see your records unless you enable sharing with the Alpha PR Labs team in Me. You can turn sharing off anytime.",
  },
  {
    title: "Access.",
    body: "Alpha PR Labs may suspend or end access for misuse or breach of these terms.",
  },
  {
    title: "Changes and law.",
    body: "We may update these terms. You must accept changed terms before continuing. Ontario law and applicable Canadian federal law govern these terms.",
  },
];

/** At the top of every template page, and on the builder when starting from a template. */
export const TEMPLATE_NOTICE =
  "This reference example draws from published research and researcher discussions. It has not been verified, is not a recommendation, and leaves you to decide your own plan.";

/** On a cycle made from a template. */
export const CYCLE_FROM_TEMPLATE_NOTE = "Your own copy of the template, your own responsibility.";

/** In the admin template editor, beside the guidance. */
export const ADMIN_TEMPLATE_CHECKLIST = {
  title: "Template writing rules",
  items: [
    "Write guidance as reference information, never instructions such as “take” or “you should.”",
    "Make no health claims or promises of results.",
    "Name each template after its regimen, never as an Alpha PR Labs protocol.",
  ],
} as const;
