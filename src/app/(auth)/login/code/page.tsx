import { redirectIfSignedIn } from "../actions";
import { AuthHero } from "@/components/auth-hero";
import { CodeForm } from "./form";

export const metadata = { title: "Sign in with a code" };

/** "Have a code?": the second phone types the six digits the first phone shows under Settings. */
export default async function LoginCodePage() {
  await redirectIfSignedIn();
  return (
    <>
      <AuthHero />
      <main className="safe-bottom flex flex-1 flex-col gap-6 px-6 pb-7 pt-7">
        <div className="flex flex-col gap-1.5">
          <h1 className="title">Have a code?</h1>
          <p className="note">On a phone that is already signed in, open Profile › Settings › Sign in on another phone, then type the six digits here. The code lasts 10 minutes and works once.</p>
        </div>
        <CodeForm />
      </main>
    </>
  );
}
