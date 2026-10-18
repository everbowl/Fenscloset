import { DevModeBanner } from "@/components/dev-mode-banner";

// The DEV banner reads the database, so these pages must render per request, never at build time.
export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <DevModeBanner />
      <main className="safe-top safe-bottom flex flex-1 flex-col justify-center px-5 py-10">
        <div className="mx-auto w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
