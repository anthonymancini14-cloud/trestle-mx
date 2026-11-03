"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileText, Search } from "lucide-react";
import { DocStatusBadge } from "@/components/status";
import { Badge, EmptyState, Input, Panel, Select, Table, Td, Th } from "@/components/ui/primitives";
import { formatDay } from "@/lib/utils";
import { DOC_TYPE_LABELS, DOC_TYPES, type DocType, type DocumentListItem } from "@/types/domain";

/** The site's document register: search, filter by type and status, sorted by number. */
export function DocumentTable({ docs }: { docs: DocumentListItem[] }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<DocType | "">("");
  const [status, setStatus] = useState<"active" | "obsolete" | "all">("active");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs.filter(
      (d) =>
        (status === "all" || d.status === status) &&
        (!type || d.doc_type === type) &&
        (!q || `${d.doc_number} ${d.title} ${d.assets.map((a) => `${a.floc} ${a.name}`).join(" ")}`.toLowerCase().includes(q)),
    );
  }, [docs, query, type, status]);

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-tx-3" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Number, title or asset tag" className="pl-8" aria-label="Search documents" />
        </div>
        <Select value={type} onChange={(e) => setType(e.target.value as DocType | "")} className="w-auto" aria-label="Type">
          <option value="">All types</option>
          {DOC_TYPES.map((t) => (
            <option key={t} value={t}>
              {DOC_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-auto" aria-label="Status">
          <option value="active">Active</option>
          <option value="obsolete">Obsolete (archive)</option>
          <option value="all">All</option>
        </Select>
        <span className="font-mono text-xs text-tx-3">{shown.length} shown</span>
      </div>
      {shown.length === 0 ? (
        <EmptyState>No documents match.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th className="w-36">Number</Th>
              <Th>Title</Th>
              <Th>Type</Th>
              <Th>Rev</Th>
              <Th>Effective</Th>
              <Th>Assets</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((d) => (
              <tr key={d.id} className="border-b border-line last:border-b-0 hover:bg-panel-2">
                <Td>
                  <Link href={`/documents/${d.id}`} className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-xs text-brass-bright hover:underline">
                    <FileText className="size-3.5" aria-hidden />
                    {d.doc_number}
                  </Link>
                </Td>
                <Td className="min-w-56">
                  <Link href={`/documents/${d.id}`} className="hover:text-brass-bright">
                    {d.title}
                  </Link>
                  {d.replaced_by && (
                    <div className="text-xs text-tx-3">
                      Replaced by <span className="font-mono">{d.replaced_by.doc_number}</span>
                    </div>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-xs text-tx-2">{DOC_TYPE_LABELS[d.doc_type]}</Td>
                <Td className="whitespace-nowrap font-mono text-xs">
                  {d.current?.rev ?? "—"}
                  {d.pending && d.status === "active" && <Badge className="ml-1.5 border-info/40 text-info">{d.pending.rev} draft</Badge>}
                </Td>
                <Td className="whitespace-nowrap text-xs text-tx-3">{formatDay(d.current?.effective_at)}</Td>
                <Td className="text-xs text-tx-2">
                  <span className="font-mono">{d.assets.slice(0, 2).map((a) => a.floc).join(", ")}</span>
                  {d.assets.length > 2 && <span className="text-tx-3"> +{d.assets.length - 2}</span>}
                </Td>
                <Td>
                  <DocStatusBadge status={d.status} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}
