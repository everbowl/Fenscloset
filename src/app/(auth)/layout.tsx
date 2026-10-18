import { DevModeBanner } from "@/components/dev-mode-banner";

// The DEV banner reads the database, so these pages must render per request, never at build time.
export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col bg-paper sm:border-x sm:border-line">
      <DevModeBanner />
      {children}
    </div>
  );
}
