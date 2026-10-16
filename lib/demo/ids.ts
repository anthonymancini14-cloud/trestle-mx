/**
 * Stable UUIDs for seed data, so the demo store and `supabase/seed.sql`
 * agree on every id. Format: 00000000-0000-4000-8KKK-NNNNNNNNNNNN where
 * KKK identifies the table and N is the row number.
 */
const TABLE_KEYS = {
  org: "001",
  site: "002",
  area: "003",
  profile: "004",
  asset: "005",
  wo: "006",
  task: "007",
  event: "008",
  part: "009",
  inventory: "00a",
  woPart: "00b",
} as const;

export type SeedTable = keyof typeof TABLE_KEYS;

export function seedId(table: SeedTable, n: number): string {
  return `00000000-0000-4000-8${TABLE_KEYS[table]}-${n.toString().padStart(12, "0")}`;
}
