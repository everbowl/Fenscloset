import { AddScreen } from "./add-screen";
import { PhotoTips } from "./photo-tips";
import { isAdmin, requirePerson } from "@/lib/auth/current";
import { getAddTips } from "@/lib/tips";

export const metadata = { title: "Add clothes" };
export const dynamic = "force-dynamic";

export default async function AddPage() {
  const me = await requirePerson();
  const tips = await getAddTips(me.id);
  return <AddScreen tips={<PhotoTips tips={tips} isAdmin={isAdmin(me)} />} />;
}
