/**
 * Sign-in, recovery and joining (R14–R16) in design v3: each page renders
 * its own AuthFrame (src/components/auth/auth-frame.tsx), with no tab bar.
 */
export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
