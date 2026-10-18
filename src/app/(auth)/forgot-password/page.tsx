import { ForgotForm } from "./form";

export const metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Forgot your password?</h1>
        <p className="mt-1 text-sm text-muted">We&apos;ll email you a link to choose a new one.</p>
      </div>
      <ForgotForm />
    </div>
  );
}
