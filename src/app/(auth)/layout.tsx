import { DevModeBanner } from "@/components/dev-mode-banner";

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
