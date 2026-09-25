import Image from "next/image";

/**
 * One auth screen's column (C1): prototype widths 420 (sign in, recover),
 * 440 (invitation, account setup), 480 (C2 reminders) and 520
 * (acknowledgement); the logo only where the prototype shows it.
 */
export function AuthCard({
  width = 420,
  logo = false,
  children,
}: {
  width?: 420 | 440 | 480 | 520;
  logo?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="app-auth-card" data-width={width}>
      {logo ? <Image className="app-auth-logo" src="/logo.jpeg" alt="Alpha PR Labs" width={44} height={44} preload /> : null}
      {children}
    </div>
  );
}
