import Link from "next/link";
import { peekResetToken } from "@/lib/auth/reset";
import { Banner } from "@/components/ui/banner";
import { AuthHero } from "@/components/auth-hero";
import { ResetForm } from "./form";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const peek = await peekResetToken(token);
  return (
    <>
      <AuthHero />
      <main className="flex flex-1 flex-col gap-[22px] px-6 pb-7 pt-7">
        {!peek.valid ? (
          <>
            <Banner tone="danger" title="This link doesn't work anymore">It expired or was already used. Reset links last 60 minutes and work once.</Banner>
            <Link href="/forgot-password" className="mono mono-11 py-2.5 underline underline-offset-4">Request a new link</Link>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <h1 className="serif text-[34px]">Choose a new <em>password</em></h1>
              <p className="mono mono-11 normal-case text-graphite">for {peek.email}</p>
            </div>
            <ResetForm token={token} />
          </>
        )}
      </main>
    </>
  );
}
