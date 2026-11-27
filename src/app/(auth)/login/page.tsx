import { LoginForm } from "./login-form";
import { redirectIfSignedIn } from "./actions";
import { AuthHero } from "@/components/auth-hero";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await redirectIfSignedIn();
  const { next } = await searchParams;
  return (
    <>
      <AuthHero tall />
      <main className="safe-bottom flex flex-1 flex-col gap-6 px-6 pb-7 pt-7">
        <div className="flex flex-col gap-1.5">
          <h1 className="serif text-[38px]">Welcome home</h1>
          <p className="note">A private wardrobe for one family</p>
        </div>
        <LoginForm next={next} />
      </main>
    </>
  );
}
