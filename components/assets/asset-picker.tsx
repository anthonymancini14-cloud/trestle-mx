"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { indexOptions, searchAssets, type AssetOption } from "@/lib/assets/search";
import { cn } from "@/lib/utils";

const NO_TAG = "";

/**
 * Searchable equipment picker. Type any part of the tag, name, class or area;
 * arrow keys move, Enter picks, Escape closes. Submits the asset id in a
 * hidden input named `name` (empty when the reporter is not sure).
 */
export function AssetPicker({
  options,
  name,
  defaultId,
  inputId,
}: {
  options: AssetOption[];
  name: string;
  defaultId?: string;
  inputId?: string;
}) {
  const index = useMemo(() => indexOptions(options), [options]);
  const [selectedId, setSelectedId] = useState<string>(
    defaultId && options.some((o) => o.id === defaultId) ? defaultId : NO_TAG,
  );
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const selected = options.find((o) => o.id === selectedId) ?? null;
  const { results, total } = useMemo(() => searchAssets(index, query), [index, query]);

  function choose(id: string) {
    setSelectedId(id);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, results.length - 1));
      scrollActive(active + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
      scrollActive(active - 1);
    } else if (e.key === "Enter") {
      if (open && results[active]) {
        e.preventDefault();
        choose(results[active].id);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function scrollActive(i: number) {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${i}"]`)?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div className="relative">
      <input type="hidden" name={name} value={selectedId} />

      {selected && !open ? (
        <div className="flex min-h-9 items-center gap-2 rounded-[3px] border border-line-strong bg-bg px-2.5 py-1.5 text-sm">
          <span className="font-mono text-[12.5px] text-brass-bright">{selected.floc}</span>
          <span className="min-w-0 flex-1 truncate text-tx">{selected.name}</span>
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            className="text-xs text-tx-3 hover:text-tx"
          >
            Change
          </button>
          <button type="button" onClick={() => choose(NO_TAG)} className="text-tx-3 hover:text-tx" title="Clear">
            <X className="size-3.5" aria-hidden />
            <span className="sr-only">Clear equipment</span>
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-tx-3" aria-hidden />
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={open && results[active] ? `${listboxId}-${active}` : undefined}
            autoComplete="off"
            value={query}
            placeholder={`Search ${options.length.toLocaleString("en-US")} assets by tag, name, class or area`}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={onKeyDown}
            className="h-9 w-full rounded-[3px] border border-line-strong bg-bg pl-8 pr-2.5 text-sm text-tx placeholder:text-tx-3 focus:border-brass focus:outline-none"
          />
        </div>
      )}

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-[3px] border border-line-strong bg-panel shadow-lg">
          <ul ref={listRef} id={listboxId} role="listbox" className="max-h-72 overflow-y-auto py-1">
            {results.map((o, i) => (
              <li
                key={o.id}
                id={`${listboxId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o.id);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn("cursor-pointer px-3 py-1.5", i === active && "bg-panel-2")}
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[12.5px] text-brass-bright">{o.floc}</span>
                  <span className="truncate text-sm text-tx">{o.name}</span>
                </div>
                <div className="truncate text-xs text-tx-3">
                  {o.className} · {o.area}
                </div>
              </li>
            ))}
            {results.length === 0 && <li className="px-3 py-3 text-sm text-tx-3">No assets match “{query}”.</li>}
          </ul>
          <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-1.5 text-xs text-tx-3">
            <span>{total > results.length ? `Showing ${results.length} of ${total.toLocaleString("en-US")}. Keep typing to narrow.` : `${total} match${total === 1 ? "" : "es"}`}</span>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                choose(NO_TAG);
              }}
              className="text-tx-2 hover:text-tx"
            >
              Not sure / no tag
            </button>
          </div>
        </div>
      )}
      {!selected && !open && <p className="mt-1 text-xs text-tx-3">Leave blank if you are not sure. The gatekeeper can add it.</p>}
    </div>
  );
}
