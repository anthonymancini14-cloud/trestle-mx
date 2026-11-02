"use client";

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, PenLine, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/primitives";
import { addDocumentRevision, createDocument, prepareDocumentUpload, type ActionResult } from "@/lib/actions";
import { DOC_FILE_TYPES, fileProblems, formatBytes, MAX_FILE_BYTES } from "@/lib/documents";
import { createBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { DOC_TYPE_LABELS, DOC_TYPES, type DocType } from "@/types/domain";

export interface AssetChoice {
  id: string;
  floc: string;
  name: string;
}

/**
 * A new document (title, type, assets, revision A) or a new revision of one.
 * The content is written here or is a file. Live, the browser uploads the file
 * straight to storage first; the demo sends it with the form.
 */
export function DocumentForm(
  props:
    | { kind: "new"; mode: "demo" | "live"; assets: AssetChoice[]; defaultAssetId?: string; defaultType?: DocType }
    | { kind: "revision"; mode: "demo" | "live"; documentId: string; nextRev: string; currentBody: string | null; onDone?: () => void },
) {
  const router = useRouter();
  const [content, setContent] = useState<"write" | "file">(props.kind === "revision" && props.currentBody === null ? "file" : "write");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const [state, action, pending] = useActionState(async (_prev: ActionResult | null, form: FormData): Promise<ActionResult> => {
    if (content === "file") {
      if (!file) return { ok: false, error: "Choose the file." };
      const problems = fileProblems(file, props.mode);
      if (problems.length) return { ok: false, error: problems.join(" ") };
      form.delete("body");
      if (props.mode === "live") {
        // Straight to storage, then register the revision with its path.
        setUploading(true);
        try {
          const prep = await prepareDocumentUpload({ name: file.name, type: file.type, size: file.size });
          if (!prep.ok || !prep.target) return prep.ok ? { ok: false, error: "Couldn't start the upload." } : prep;
          const up = await createBrowserClient().storage.from("documents").uploadToSignedUrl(prep.target.path, prep.target.token, file, { contentType: file.type });
          if (up.error) return { ok: false, error: `Upload failed: ${up.error.message}` };
          form.delete("file");
          form.set("file_path", prep.target.path);
          form.set("file_name", file.name);
          form.set("file_mime", file.type);
          form.set("file_size", String(file.size));
        } finally {
          setUploading(false);
        }
      } else {
        form.set("file", file);
      }
    } else {
      form.delete("file");
    }
    if (props.kind === "new") {
      const res = await createDocument(null, form);
      if (res.ok && res.id) router.push(`/documents/${res.id}`);
      return res;
    }
    const res = await addDocumentRevision(props.documentId, null, form);
    if (res.ok) props.onDone?.();
    return res;
  }, null);

  const busy = pending || uploading;
  return (
    <form action={action} className="space-y-4">
      {props.kind === "new" && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
            <div>
              <Label htmlFor="doc-title">Title</Label>
              <Input id="doc-title" name="title" required minLength={3} placeholder="Chilled water pump seal replacement" />
            </div>
            <div>
              <Label htmlFor="doc-type">Type</Label>
              <Select id="doc-type" name="doc_type" defaultValue={props.defaultType ?? "procedure"}>
                {DOC_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DOC_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <AssetChecklist name="asset_ids" assets={props.assets} defaultIds={props.defaultAssetId ? [props.defaultAssetId] : []} />
        </>
      )}

      <div>
        <Label htmlFor="rev-summary">{props.kind === "new" ? "Revision A: what this is" : `Rev ${props.nextRev}: what changes`}</Label>
        <Input
          id="rev-summary"
          name="change_summary"
          required
          minLength={5}
          defaultValue={props.kind === "new" ? "Initial issue." : ""}
          placeholder={props.kind === "new" ? "Initial issue." : "Adds the soft foot check before alignment"}
        />
      </div>

      <div role="radiogroup" aria-label="Content" className="flex gap-2">
        {(
          [
            ["write", "Write it here", PenLine],
            ["file", "Upload a file", FileUp],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={content === value}
            onClick={() => setContent(value)}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-[3px] border px-3 text-sm",
              content === value ? "border-brass bg-brass/10 text-tx" : "border-line-strong text-tx-2 hover:text-tx",
            )}
          >
            <Icon className="size-4" aria-hidden /> {label}
          </button>
        ))}
      </div>

      {content === "write" ? (
        <div>
          <Label htmlFor="rev-body">Document</Label>
          <Textarea
            id="rev-body"
            name="body"
            rows={14}
            className="font-mono text-[13px]"
            defaultValue={props.kind === "revision" ? (props.currentBody ?? "") : ""}
            placeholder={"# Title\n\n## Steps\n\n1. First step\n2. Second step\n\n| Item | Value |\n|---|---|\n| Torque | 85 ft-lb |"}
          />
          <p className="mt-1 text-xs text-tx-3"># headings, numbered or - lists, | tables |, **bold**.</p>
        </div>
      ) : (
        <div>
          <Label htmlFor="rev-file">File</Label>
          <input
            id="rev-file"
            type="file"
            accept={Object.keys(DOC_FILE_TYPES).join(",")}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-tx-2 file:mr-3 file:min-h-11 file:rounded-[3px] file:border file:border-line-strong file:bg-panel-2 file:px-3 file:text-sm file:text-tx"
          />
          <p className="mt-1 text-xs text-tx-3">
            PDF, image or text, up to {MAX_FILE_BYTES[props.mode] / 1024 / 1024} MB{props.mode === "demo" ? " in the demo" : ""}.
            {file && ` ${file.name}, ${formatBytes(file.size)}.`}
          </p>
        </div>
      )}

      <p className="text-xs text-tx-3">
        Saved as a draft. A supervisor or admin other than you approves it; then it becomes the current revision
        {props.kind === "revision" ? " and the one it replaces is archived as superseded" : ""}.
      </p>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-bad">
          {state.error}
        </p>
      )}
      {state?.ok && props.kind === "revision" && <p className="text-sm text-good">Draft saved. It needs approval before anyone uses it.</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {uploading ? "Uploading…" : pending ? "Saving…" : props.kind === "new" ? "Create document" : `Save Rev ${props.nextRev} draft`}
        </Button>
        {props.kind === "revision" && props.onDone && (
          <Button type="button" variant="ghost" onClick={props.onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/** Pick the assets a document applies to. Search by tag or name. */
export function AssetChecklist({ name, assets, defaultIds }: { name: string; assets: AssetChoice[]; defaultIds: string[] }) {
  const [chosen, setChosen] = useState(new Set(defaultIds));
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? assets.filter((a) => `${a.floc} ${a.name}`.toLowerCase().includes(q)) : assets;
    return [...list].sort((a, b) => Number(chosen.has(b.id)) - Number(chosen.has(a.id)) || a.floc.localeCompare(b.floc));
  }, [assets, query, chosen]);
  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-medium text-tx-2">
        Applies to {chosen.size === 0 ? "(no assets yet)" : `${chosen.size} asset${chosen.size === 1 ? "" : "s"}`}
      </legend>
      {[...chosen].map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-tx-3" aria-hidden />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tag or name" className="pl-8" aria-label="Search assets" />
      </div>
      <ul className="mt-1 max-h-56 overflow-y-auto rounded-[3px] border border-line">
        {shown.slice(0, 60).map((a) => (
          <li key={a.id}>
            <label className="flex min-h-10 cursor-pointer items-center gap-2 border-b border-line px-2.5 text-sm last:border-b-0 hover:bg-panel-2">
              <input type="checkbox" checked={chosen.has(a.id)} onChange={() => toggle(a.id)} className="size-4 accent-[var(--brass)]" />
              <span className="font-mono text-xs text-tx-2">{a.floc}</span>
              <span className="truncate text-tx-3">{a.name}</span>
            </label>
          </li>
        ))}
        {shown.length > 60 && <li className="px-2.5 py-2 text-xs text-tx-3">{shown.length - 60} more: narrow the search.</li>}
      </ul>
    </fieldset>
  );
}
