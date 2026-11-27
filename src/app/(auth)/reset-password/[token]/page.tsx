import Link from "next/link";
import { peekResetToken } from "@/lib/auth/reset";
import { AuthHero } from "@/components/auth-hero";
import { ResetForm } from "./form";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const peek = await peekResetToken(token);
  return (
    <>
      <AuthHero />
      <main className="safe-bottom flex flex-1 flex-col gap-6 px-6 pb-7 pt-7">
        {!peek.valid ? (
          <>
            <div className="flex flex-col gap-1.5" role="alert">
              <h1 className="title">This link doesn&apos;t work anymore</h1>
              <p className="note">It expired or was already used. Reset links last 60 minutes and work once.</p>
            </div>
            <Link href="/forgot-password" className="pill pill-solid h-12 w-full">Request a new link</Link>
            <Link href="/login" className="pill pill-quiet h-12 w-full">Back to sign in</Link>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <h1 className="title">Choose a new password</h1>
              <p className="note">for {peek.email}</p>
            </div>
            <ResetForm token={token} />
          </>
        )}
      </main>
    </>
  );
}
