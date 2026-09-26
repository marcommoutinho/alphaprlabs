import { redirect } from "next/navigation";
import { ADMIN_HOME } from "@/lib/auth/paths";

export default function AdminHome() {
  redirect(ADMIN_HOME);
}
