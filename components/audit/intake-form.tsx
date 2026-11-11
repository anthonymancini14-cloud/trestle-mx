"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/primitives";
import { submitWorkLog } from "@/lib/actions";

/** Paste one log entry for extraction. `blocked` explains why new entries can't be taken right now. */
export function IntakeForm({ blocked, mode }: { blocked: string | null; mode: "demo" | "live" }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const res = await submitWorkLog(text);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setText("");
      router.push(`/audit/${res.jobId}`);
    });

  return (
    <form
      className="space-y-2 px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Label htmlFor="worklog-text">Log entry</Label>
      <Textarea
        id="worklog-text"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={blocked !== null || pending}
        placeholder="CRAH-02 high supply air temp alarm. Found return filters loaded, dp 1.4 inwc as found…"
        className="font-mono text-[13px]"
      />
      {blocked && <p className="text-xs text-tx-3">{blocked}</p>}
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={blocked !== null || pending || text.trim().length < 10}>
          <ScanSearch aria-hidden /> {pending ? "Reading…" : "Extract"}
        </Button>
        {!blocked && (
          <span className="text-xs text-tx-3">
            {mode === "demo" ? "Runs on the local model now and opens the result for review." : "Goes to the queue. The worker beside the local model picks it up."}
          </span>
        )}
      </div>
    </form>
  );
}
