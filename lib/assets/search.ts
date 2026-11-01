/**
 * Asset search for pickers. Plants and data centers carry thousands of
 * assets, so pickers search instead of scrolling. Every word typed must match
 * somewhere in the tag, name, class or area (in any order); results rank tag
 * matches first. Pure, so it runs in the browser and in tests.
 */
export interface AssetOption {
  id: string;
  floc: string;
  name: string;
  className: string;
  area: string;
}

export interface IndexedOption extends AssetOption {
  /** Lower-cased search text with punctuation treated as spaces. */
  haystack: string;
  flocKey: string;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();
/** Tags compare without separators, so "hspp201b" and "HSP-P-201B" match. */
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function indexOptions(options: AssetOption[]): IndexedOption[] {
  return options.map((o) => ({
    ...o,
    haystack: ` ${normalize(`${o.floc} ${o.name} ${o.className} ${o.area}`)} `,
    flocKey: compact(o.floc),
  }));
}

export function searchAssets(index: IndexedOption[], query: string, limit = 50): { results: IndexedOption[]; total: number } {
  const words = normalize(query).split(" ").filter(Boolean);
  if (!words.length) return { results: index.slice(0, limit), total: index.length };
  const compactQuery = compact(query);

  const scored: { option: IndexedOption; score: number }[] = [];
  for (const option of index) {
    let score = 0;
    let all = true;
    for (const word of words) {
      const at = option.haystack.indexOf(word);
      if (at < 0 && !option.flocKey.includes(compact(word))) {
        all = false;
        break;
      }
      // Whole words rank above word starts, which rank above mid-word matches.
      if (option.haystack.includes(` ${word} `)) score += 3;
      else if (at >= 0 && option.haystack[at - 1] === " ") score += 2;
      else score += 1;
    }
    if (!all) continue;
    if (compactQuery && option.flocKey === compactQuery) score += 100;
    else if (compactQuery && option.flocKey.startsWith(compactQuery)) score += 20;
    else if (compactQuery.length >= 3 && option.flocKey.includes(compactQuery)) score += 10;
    scored.push({ option, score });
  }
  // Ties go to the shorter, more specific name ("pump B" before "pump B motor"), then the tag.
  scored.sort(
    (a, b) => b.score - a.score || a.option.name.length - b.option.name.length || a.option.floc.localeCompare(b.option.floc),
  );
  return { results: scored.slice(0, limit).map((s) => s.option), total: scored.length };
}
