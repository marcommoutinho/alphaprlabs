import { redirect } from "next/navigation";
import { RESEARCH_HOME } from "@/lib/auth/paths";

export default function ResearcherHome() {
  redirect(RESEARCH_HOME);
}
