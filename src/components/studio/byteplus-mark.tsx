import Image from "next/image";

export function BytePlusMark({ size = 20 }: { size?: number }) {
  return (
    <Image
      className="byteplus-mark"
      src="/brand/byteplus-mark.png"
      alt=""
      width={size}
      height={size}
      unoptimized
    />
  );
}
