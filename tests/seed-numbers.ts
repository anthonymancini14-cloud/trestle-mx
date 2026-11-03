/**
 * Work order numbers are JCN-WCE numbers built from the demo's dates, so tests
 * find seeded work orders by seed key instead of a fixed number.
 */
import { demoSeedNumbers } from "@/lib/data/demo-repository";
import { seedNumbers, type Dataset } from "@/lib/demo/dataset";

/** Number of a seeded work order in a dataset built by the test. */
export const dbNum = (db: Pick<Dataset, "workOrders">, seed: number): string => {
  const n = seedNumbers(db).get(seed);
  if (!n) throw new Error(`No seed work order ${seed}`);
  return n;
};

/** Number of a seeded work order in the demo store the repositories use. */
export const liveNum = (seed: number): string => {
  const n = demoSeedNumbers().get(seed);
  if (!n) throw new Error(`No seed work order ${seed}`);
  return n;
};
