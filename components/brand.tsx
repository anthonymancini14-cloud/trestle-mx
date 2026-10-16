import Image from "next/image";
import { cn } from "@/lib/utils";

export function TrestleMark({ className }: { className?: string }) {
  return (
    <Image src="/trestle-mark.png" alt="" width={360} height={126} priority className={cn("h-auto", className)} />
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display font-bold uppercase tracking-[0.12em] text-tx", className)}>
      Trestle<span className="text-brass">.MX</span>
    </span>
  );
}
