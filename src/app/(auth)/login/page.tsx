import { LoginForm } from "./login-form";
import { redirectIfSignedIn } from "./actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await redirectIfSignedIn();
  const { next } = await searchParams;
  return (
    <div>
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Fen&apos;s Closet</h1>
        <p className="mt-1 text-sm text-muted">Sign in to your closet.</p>
      </div>
      <LoginForm next={next} />
    </div>
  );
}
