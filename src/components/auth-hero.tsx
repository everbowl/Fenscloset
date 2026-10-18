import Image from "next/image";
import { Wordmark } from "@/components/brand";

/** Bone hero with the garments photo and the wordmark, per the sign-in mockup. */
export function AuthHero({ tall = false }: { tall?: boolean }) {
  return (
    <div className={`relative overflow-hidden bg-bone ${tall ? "h-[min(400px,46dvh)]" : "h-[180px]"}`}>
      <Image src="/images/login-hero.jpg" alt="" fill priority sizes="480px" className="object-cover object-[center_40%]" />
      <div className="safe-top absolute inset-x-0 top-[26px] flex justify-center">
        <Wordmark withMark size="md" />
      </div>
    </div>
  );
}
