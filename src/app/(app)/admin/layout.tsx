import { requirePerson, isAdmin } from "@/lib/auth/current";
import { Forbidden } from "@/components/forbidden";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const person = await requirePerson();
  if (!isAdmin(person)) return <Forbidden />;
  return <>{children}</>;
}
