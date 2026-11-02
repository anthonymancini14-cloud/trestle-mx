export type {
  Asset,
  AssetClassWithModes,
  ClassSpare,
  Criticality,
  InventoryItem,
  PmSchedule,
  PmTask,
  WoTask,
} from "@/types/domain";
import type { WoTask } from "@/types/domain";

/** The parts of a job plan a generated PM work order needs. */
export interface JobPlanLike {
  summary: string;
  requires_shutdown: boolean;
  tasks: Omit<WoTask, "id" | "wo_id" | "is_complete">[];
}
