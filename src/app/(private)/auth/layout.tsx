import Image from "next/image";
import "@/styles/app/auth.css";

/** Centered sign-in / invitation / recovery frame (max width 420px). */
export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="app-auth">
      <main className="app-auth-card">
        <Image className="app-auth-logo" src="/logo.jpeg" alt="Alpha PR Labs" width={44} height={44} priority />
        {children}
      </main>
    </div>
  );
}
