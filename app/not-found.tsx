import Link from "next/link";
import { Wordmark } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <Wordmark className="text-2xl" />
      <p className="text-tx-2">That record doesn&apos;t exist at this site. If you were on the demo, it may have been reset.</p>
      <Link href="/dashboard" className="text-brass hover:text-brass-bright">
        Back to the dashboard
      </Link>
    </main>
  );
}
