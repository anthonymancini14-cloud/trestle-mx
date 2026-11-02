import type { ReactNode } from "react";

/**
 * Renders a document written in Trestle: a small, safe markdown subset
 * (headings, paragraphs, bullet and numbered lists, tables, bold). Built as
 * React elements, never as raw HTML.
 */
export function DocBody({ source }: { source: string }) {
  return <div className="doc-body space-y-3 text-[15px] leading-relaxed text-tx">{blocks(source)}</div>;
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-brass-bright">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

function blocks(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = out.length;
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const cls =
        level === 1
          ? "font-display text-2xl font-semibold tracking-wide"
          : level === 2
            ? "pt-2 font-display text-lg font-semibold uppercase tracking-wide text-brass-bright"
            : "pt-1 text-sm font-semibold uppercase tracking-wider text-tx-2";
      const Tag = (`h${level + 1}` as "h2" | "h3" | "h4");
      out.push(
        <Tag key={key} className={cls}>
          {inline(heading[2])}
        </Tag>,
      );
      i++;
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        <div key={key} className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j} className="border border-line bg-panel-2 px-2.5 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-tx-3">
                    {inline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, j) => (
                <tr key={j}>
                  {r.map((c, k) => (
                    <td key={k} className="border border-line px-2.5 py-1.5 align-top">
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const bullet = /^\s*-\s+/;
    const numbered = /^\s*\d+\.\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const re = ordered ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) {
        items.push(lines[i].replace(re, ""));
        i++;
      }
      const List = ordered ? "ol" : "ul";
      out.push(
        <List key={key} className={ordered ? "list-decimal space-y-1.5 pl-6 marker:font-mono marker:text-tx-3" : "list-disc space-y-1 pl-6 marker:text-tx-3"}>
          {items.map((t, j) => (
            <li key={j} className="pl-1">
              {inline(t)}
            </li>
          ))}
        </List>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|\s*-\s|\s*\d+\.\s|\s*\|)/.test(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    out.push(
      <p key={key} className="text-tx-2">
        {inline(para.join(" "))}
      </p>,
    );
  }
  return out;
}
