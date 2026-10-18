import { LoginForm } from "./login-form";
import { redirectIfSignedIn } from "./actions";
import { AuthHero } from "@/components/auth-hero";
import { DEV_ADMIN_EMAIL, isDevMode } from "@/lib/auth/dev-mode";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await redirectIfSignedIn();
  const { next } = await searchParams;
  return (
    <>
      <AuthHero tall />
      <main className="safe-bottom flex flex-1 flex-col gap-[22px] px-6 pb-7 pt-[30px]">
        <div className="flex flex-col gap-1">
          <h1 className="serif text-[38px]">Welcome <em>home</em></h1>
          <p className="mono mono-11 text-graphite">The Fenster family wardrobe</p>
        </div>
        <LoginForm next={next} prefillEmail={isDevMode() ? DEV_ADMIN_EMAIL : undefined} />
      </main>
    </>
  );
}
