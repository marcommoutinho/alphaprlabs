import { redirect } from "next/navigation";
import { ROLE_HOME } from "@/components/app-shell/nav";

export default function ResearcherHome() {
  redirect(ROLE_HOME.researcher);
}
