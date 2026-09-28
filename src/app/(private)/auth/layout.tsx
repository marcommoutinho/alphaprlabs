import "@/styles/app/auth.css";

/**
 * Centered frame for the sign-in, invitation and recovery screens (C1), in
 * the legacy style scope until V4 rebuilds joining (R14–R16).
 */
export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="app-root">
      <main className="app-auth">{children}</main>
    </div>
  );
}
