import { cookies } from "next/headers";

export const SHOP_FOR_COOKIE = "fc_shop_for";

/** The last person picked under "Shopping for" (Jeff, 31 Oct 2026, N1): carries across Shop, Looking-for and Together. */
export async function rememberedShopFor(): Promise<string | null> {
  return (await cookies()).get(SHOP_FOR_COOKIE)?.value ?? null;
}

export async function rememberShopFor(personId: string): Promise<void> {
  (await cookies()).set(SHOP_FOR_COOKIE, personId, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
}
