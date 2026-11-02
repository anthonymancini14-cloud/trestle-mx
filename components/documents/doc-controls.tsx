"use client";

import { useState, useTransition } from "react";
import { Archive, Check, FilePlus2, Link2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/primitives";
import { obsoleteDocument, reviewDocumentRevision, setDocumentAssets } from "@/lib/actions";
import { AssetChecklist, DocumentForm, type AssetChoice } from "./document-form";

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-bad">
      {error}
    </p>
  ) : null;
}

/** Approve or reject a draft revision. */
export function ReviewDraft({ documentId, revisionId, rev }: { documentId: string; revisionId: string; rev: string }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (approve: boolean) =>
    start(async () => {
      const res = await reviewDocumentRevision({ documentId, revisionId, approve, note });
      setError(res.ok ? null : res.error);
    });
  return (
    <div className="space-y-2">
      <Label htmlFor="review-note">Review note</Label>
      <Textarea id="review-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Needed to reject; optional to approve." />
      <ErrorLine error={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="primary" disabled={pending} onClick={() => run(true)}>
          <Check className="size-4" aria-hidden /> Approve Rev {rev}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => run(false)}>
          <X className="size-4" aria-hidden /> Reject
        </Button>
      </div>
    </div>
  );
}

/** Write the next revision. */
export function NewRevision({ documentId, nextRev, currentBody, mode }: { documentId: string; nextRev: string; currentBody: string | null; mode: "demo" | "live" }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        <FilePlus2 className="size-4" aria-hidden /> Write Rev {nextRev}
      </Button>
    );
  }
  return <DocumentForm kind="revision" mode={mode} documentId={documentId} nextRev={nextRev} currentBody={currentBody} onDone={() => setOpen(false)} />;
}

/** Archive a document as obsolete and name what replaces it. */
export function ObsoleteDocument({ documentId, candidates }: { documentId: string; candidates: { id: string; doc_number: string; title: string }[] }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [replacedBy, setReplacedBy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <Button type="button" variant="ghost" onClick={() => setOpen(true)}>
        <Archive className="size-4" aria-hidden /> Make obsolete
      </Button>
    );
  }
  return (
    <div className="w-full space-y-2 rounded-[3px] border border-warn/40 bg-warn/[0.06] p-3">
      <p className="text-xs text-tx-2">
        The document is archived: every revision stays readable, and closed work orders keep the revision they used. It can&apos;t be used on new work.
      </p>
      <div>
        <Label htmlFor="obs-reason">Why it&apos;s obsolete</Label>
        <Input id="obs-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Replaced by the new procedure" />
      </div>
      <div>
        <Label htmlFor="obs-by">Replaced by</Label>
        <Select id="obs-by" value={replacedBy} onChange={(e) => setReplacedBy(e.target.value)}>
          <option value="">Nothing replaces it</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.doc_number} {c.title}
            </option>
          ))}
        </Select>
      </div>
      <ErrorLine error={error} />
      <div className="flex gap-2">
        <Button
          type="button"
          variant="primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await obsoleteDocument({ documentId, reason, replacedById: replacedBy || null });
              if (res.ok) setOpen(false);
              setError(res.ok ? null : res.error);
            })
          }
        >
          Archive as obsolete
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Change which assets a document applies to. */
export function EditDocumentAssets({ documentId, assets, linked }: { documentId: string; assets: AssetChoice[]; linked: string[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-9 items-center gap-1 text-sm text-brass hover:text-brass-bright">
        <Link2 className="size-4" aria-hidden /> Change assets
      </button>
    );
  }
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        const ids = new FormData(e.currentTarget).getAll("asset_ids").map(String);
        start(async () => {
          const res = await setDocumentAssets(documentId, ids);
          if (res.ok) setOpen(false);
          setError(res.ok ? null : res.error);
        });
      }}
    >
      <AssetChecklist name="asset_ids" assets={assets} defaultIds={linked} />
      <ErrorLine error={error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          Save assets
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
