import Image from "next/image";

export function HeroMedia() {
  return (
    <div className="showroom-hero__media" aria-hidden="true">
      <Image
        alt=""
        fill
        priority
        sizes="100vw"
        src="/images/hisense/onecare-home.png"
      />
      <div className="showroom-hero__shade" />
    </div>
  );
}
