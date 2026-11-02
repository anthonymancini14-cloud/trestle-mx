/**
 * Job control numbers and work center events, after the Air Force system.
 *
 *   JCN  263045000      26 = year, 304 = Julian day, 5000 = the site's job ID
 *   WCE  263045000-002  the second work center event on that JCN
 *
 * Each site has a 4-digit block (Cedar Flats 5000, Basalt Ridge 1000). The job
 * ID counts up from the block each day and starts over on the next Julian day,
 * so a JCN is unique per site and says when the discrepancy was written up.
 * WCE numbers count within the JCN: the primary shop's WCE is -001.
 */

/** Day of the year, 1–366, for an ISO date. */
export function julianDay(iso: string): number {
  const d = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  const jan1 = Date.parse(`${iso.slice(0, 4)}-01-01T00:00:00Z`);
  return Math.round((d - jan1) / 86_400_000) + 1;
}

/** YY + JJJ for an ISO date: "2026-10-31" → "26304". */
export function jcnPrefix(iso: string): string {
  return iso.slice(2, 4) + String(julianDay(iso)).padStart(3, "0");
}

export function formatJcn(iso: string, jobId: number): string {
  if (!Number.isInteger(jobId) || jobId < 0 || jobId > 9999) throw new Error(`Job ID ${jobId} is outside 0000–9999`);
  return jcnPrefix(iso) + String(jobId).padStart(4, "0");
}

export function wceNumber(jcn: string, seq: number): string {
  return `${jcn}-${String(seq).padStart(3, "0")}`;
}

/** The next JCN for a site on a date: one past the highest job ID used that day, starting at the block. */
export function nextJcn(existing: Iterable<string>, iso: string, block: number): string {
  const prefix = jcnPrefix(iso);
  let max = block - 1;
  for (const j of existing) if (j.startsWith(prefix)) max = Math.max(max, Number(j.slice(5)));
  return formatJcn(iso, max + 1);
}

/** The next WCE number within a JCN. */
export function nextWceSeq(seqs: Iterable<number>): number {
  let max = 0;
  for (const s of seqs) max = Math.max(max, s);
  return max + 1;
}

/** "263045000" → { year: 2026, julianDay: 304, jobId: 5000 }. */
export function parseJcn(jcn: string): { year: number; julianDay: number; jobId: number } | null {
  const m = /^(\d{2})(\d{3})(\d{4})$/.exec(jcn);
  return m ? { year: 2000 + Number(m[1]), julianDay: Number(m[2]), jobId: Number(m[3]) } : null;
}

/** The sign-off on a WCE that couldn't be closed and was written up under a new JCN. */
export function deferralNote(newJcn: string, reason: string): string {
  return `Corrective action deferred, see JCN ${newJcn}. ${reason.trim()}`;
}
