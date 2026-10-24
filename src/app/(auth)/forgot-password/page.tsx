import { ForgotForm } from "./form";
import { AuthHero } from "@/components/auth-hero";

export const metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthHero />
      <main className="flex flex-1 flex-col gap-[22px] px-6 pb-7 pt-7">
        <div className="flex flex-col gap-1">
          <h1 className="serif text-[34px]">Forgot your <em>password?</em></h1>
          <p className="mono mono-11 text-graphite">We&apos;ll email you a link to pick a new one</p>
        </div>
        <ForgotForm />
      </main>
    </>
  );
}
