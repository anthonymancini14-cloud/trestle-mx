/**
 * Failure mechanisms and causes for the troubleshooting record, so causes can
 * be counted across a fleet. The structure follows ISO 14224 (failure mode per
 * equipment class, then mechanism and cause); names are paraphrased. Failure
 * modes come from each asset class in the class library. These two lists are
 * org-wide; an organization can add class-specific codes.
 */
import type { FailureCodeKind } from "@/types/domain";

export interface FailureCodeDef {
  kind: FailureCodeKind;
  code: string;
  name: string;
}

const mechanisms: [string, string][] = [
  ["1.1", "Leakage"],
  ["1.2", "Vibration"],
  ["1.3", "Clearance or alignment failure"],
  ["1.4", "Deformation"],
  ["1.5", "Looseness"],
  ["1.6", "Sticking"],
  ["2.1", "Cavitation"],
  ["2.2", "Corrosion"],
  ["2.3", "Erosion"],
  ["2.4", "Wear"],
  ["2.5", "Breakage"],
  ["2.6", "Fatigue"],
  ["2.7", "Overheating"],
  ["2.8", "Burst"],
  ["3.1", "Control failure"],
  ["3.2", "No signal, indication or alarm"],
  ["3.3", "Faulty signal, indication or alarm"],
  ["3.4", "Out of adjustment or calibration"],
  ["3.5", "Software or firmware failure"],
  ["4.1", "Short circuit"],
  ["4.2", "Open circuit"],
  ["4.3", "No power or voltage"],
  ["4.4", "Faulty power or voltage"],
  ["4.5", "Earth or insulation fault"],
  ["5.1", "Blockage or plugged"],
  ["5.2", "Contamination"],
  ["5.3", "Other external influence"],
  ["6.1", "No cause found"],
  ["6.2", "Combined mechanisms"],
  ["6.3", "Other"],
];

const causes: [string, string][] = [
  ["1.1", "Design: improper capacity"],
  ["1.2", "Design: improper material"],
  ["2.1", "Fabrication error"],
  ["2.2", "Installation error"],
  ["3.1", "Operated outside design"],
  ["3.2", "Operating error"],
  ["3.3", "Maintenance error"],
  ["3.4", "Expected wear and tear"],
  ["4.1", "Documentation or procedure error"],
  ["4.2", "Management or planning error"],
  ["5.1", "No cause found"],
  ["5.2", "Common cause"],
  ["5.3", "Combined causes"],
  ["5.4", "Other"],
];

export const FAILURE_CODES: FailureCodeDef[] = [
  ...mechanisms.map(([code, name]) => ({ kind: "mechanism" as const, code, name })),
  ...causes.map(([code, name]) => ({ kind: "cause" as const, code, name })),
];
