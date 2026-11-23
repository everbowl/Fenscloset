import { ForgotForm } from "./form";
import { AuthHero } from "@/components/auth-hero";

export const metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthHero />
      <main className="safe-bottom flex flex-1 flex-col gap-6 px-6 pb-7 pt-7">
        <div className="flex flex-col gap-1.5">
          <h1 className="title">Forgot your password?</h1>
          <p className="note">We&apos;ll email you a link to pick a new one.</p>
        </div>
        <ForgotForm />
      </main>
    </>
  );
}
