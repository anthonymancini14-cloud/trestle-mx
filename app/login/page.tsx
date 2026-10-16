import { redirect } from "next/navigation";
import { TrestleMark, Wordmark } from "@/components/brand";
import { LoginForm } from "@/components/login-form";
import { isLiveMode } from "@/lib/config";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!isLiveMode()) redirect("/");
  const { error } = await searchParams;
  return (
    <main className="blueprint flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-[3px] border border-line bg-panel p-6">
        <div className="mb-6 flex flex-col items-center gap-2">
          <TrestleMark className="w-36" />
          <Wordmark className="text-2xl" />
        </div>
        {error === "no-site-access" && (
          <p className="mb-4 rounded-[3px] border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            Your account has no site access yet. Ask an admin to add you to a site.
          </p>
        )}
        <LoginForm />
      </div>
    </main>
  );
}
