import Link from "next/link";
import { peekResetToken } from "@/lib/auth/reset";
import { Banner } from "@/components/ui/banner";
import { ResetForm } from "./form";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const peek = await peekResetToken(token);
  if (!peek.valid) {
    return (
      <div className="space-y-4">
        <Banner tone="danger" title="This link doesn't work anymore">It expired or was already used. Reset links last 60 minutes and work once.</Banner>
        <Link href="/forgot-password" className="block text-center text-sm font-medium text-accent">Request a new link</Link>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="mt-1 text-sm text-muted">for {peek.email}</p>
      </div>
      <ResetForm token={token} />
    </div>
  );
}
