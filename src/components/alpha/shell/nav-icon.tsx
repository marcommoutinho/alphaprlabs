import {
  Activity,
  BookOpen,
  Briefcase,
  Calendar,
  FlaskConical,
  Package,
  Receipt,
  Sun,
  User,
  Users,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";
import type { NavIcon as NavIconName } from "@/lib/alpha/nav";

// Lucide names from the design (§8): sun, calendar, activity, book-open,
// briefcase, user, flask-conical, package, receipt, users.
const ICONS: Record<NavIconName, LucideIcon> = {
  today: Sun,
  cycles: Calendar,
  progress: Activity,
  library: BookOpen,
  supplies: FlaskConical,
  me: User,
  business: Briefcase,
  overview: Briefcase,
  stock: Package,
  ledger: Receipt,
  people: Users,
};

export function NavIcon({ name, ...props }: LucideProps & { name: NavIconName }) {
  const Icon = ICONS[name];
  return <Icon aria-hidden {...props} />;
}
