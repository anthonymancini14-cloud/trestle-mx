/**
 * Document control rules (TMX-026). Pure functions shared by the server
 * actions, the demo store and the UI.
 */
import type { DocType, DocumentRevision, WoDocumentView } from "@/types/domain";
import { DOC_TYPE_CODES } from "@/types/domain";

/** Files a revision may carry. Drawings and manuals are usually PDFs; photos and drawings may be images. */
export const DOC_FILE_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WebP",
  "image/svg+xml": "SVG",
  "text/plain": "Text",
};

/** Live uploads go straight to storage; the demo keeps files in memory, so it takes small ones. */
export const MAX_FILE_BYTES = { live: 50 * 1024 * 1024, demo: 2 * 1024 * 1024 } as const;

/** Document number: site code, type code, four-digit sequence, e.g. CFD-DWG-0001. */
export function formatDocNumber(siteCode: string, type: DocType, n: number): string {
  return `${siteCode}-${DOC_TYPE_CODES[type]}-${String(n).padStart(4, "0")}`;
}

/** The next number for a type at a site, after the highest one already used. */
export function nextDocNumber(existing: string[], siteCode: string, type: DocType): string {
  const prefix = `${siteCode}-${DOC_TYPE_CODES[type]}-`;
  const used = existing.filter((d) => d.startsWith(prefix)).map((d) => Number(d.slice(prefix.length)) || 0);
  return formatDocNumber(siteCode, type, Math.max(0, ...used) + 1);
}

/** Revision letters: A, B … Z, AA, AB … */
export function revLabel(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** The letter for a new revision: one past the last revision written (rejected drafts use up their letter). */
export function nextRev(revisions: Pick<DocumentRevision, "rev">[]): string {
  return revLabel(revisions.length);
}

/** The revision in force: the current one. */
export function currentRevision<T extends Pick<DocumentRevision, "status">>(revisions: T[]): T | null {
  return revisions.find((r) => r.status === "current") ?? null;
}

/**
 * The revision kept with a work order when it closes: the one last opened from
 * the work order (what the crew actually used), otherwise the one current at
 * close, otherwise the newest released revision.
 */
export function revisionToPin(
  views: Pick<WoDocumentView, "revision_id" | "viewed_at">[],
  revisions: Pick<DocumentRevision, "id" | "status" | "effective_at">[],
): string | null {
  const lastView = [...views].sort((a, b) => b.viewed_at.localeCompare(a.viewed_at))[0];
  if (lastView) return lastView.revision_id;
  const current = currentRevision(revisions);
  if (current) return current.id;
  const released = revisions.filter((r) => r.effective_at).sort((a, b) => b.effective_at!.localeCompare(a.effective_at!))[0];
  return released?.id ?? null;
}

/** Problems with an uploaded file before it is accepted. Empty when it is fine. */
export function fileProblems(file: { name: string; type: string; size: number }, mode: "demo" | "live"): string[] {
  const out: string[] = [];
  if (!DOC_FILE_TYPES[file.type]) out.push(`${file.name}: use a PDF, image or text file.`);
  if (file.size === 0) out.push(`${file.name} is empty.`);
  if (file.size > MAX_FILE_BYTES[mode]) {
    out.push(`${file.name} is over ${MAX_FILE_BYTES[mode] / 1024 / 1024} MB${mode === "demo" ? " (the demo keeps files in memory)" : ""}.`);
  }
  return out;
}

/** Problems with a new revision. Empty when it is fine. */
export function revisionProblems(input: { change_summary: string; body: string | null; hasFile: boolean }): string[] {
  const out: string[] = [];
  if (input.change_summary.trim().length < 5) out.push("Say what this revision changes (or 'Initial issue').");
  if (!input.hasFile && (!input.body || input.body.trim().length < 20)) out.push("Attach the file or write the document.");
  return out;
}

/** Storage path for a revision's file: the site id first, so storage policies can scope by site. */
export function storagePath(siteId: string, uploadId: string, fileName: string): string {
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120);
  return `${siteId}/${uploadId}/${safe}`;
}

/** Document numbers a job plan cites in its references (Planning Mode links them to the work order). */
export function citedDocuments<T extends { doc_number: string }>(references: { source: string; note: string }[], documents: T[]): T[] {
  const text = references.map((r) => `${r.source} ${r.note}`).join(" ").toUpperCase();
  return documents.filter((d) => text.includes(d.doc_number.toUpperCase()));
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
