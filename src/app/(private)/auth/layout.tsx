import "@/styles/app/auth.css";

/** Centered frame for the sign-in, invitation and recovery screens (C1). */
export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <main className="app-auth">{children}</main>;
}
