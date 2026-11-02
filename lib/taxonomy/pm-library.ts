/**
 * Starter PM programs for the asset class library.
 *
 * Every task says which failure modes it addresses, so each one can be
 * defended (or killed) on what it prevents or finds. Intervals are starter
 * defaults from general practice and are meant to be tuned to OEM guidance,
 * the site's own failure history and its regulators. Criticality decides who
 * gets a task: a task lists the criticalities that get it and can shorten the
 * interval for crit A, and a class can be run to failure at a criticality (no
 * PM, and no "uncovered failure mode" warning).
 *
 * Strategies:
 *   time_based       fixed-interval service or replacement
 *   condition_based  inspection or monitoring that finds a failure developing
 *   failure_finding  a test that proves a hidden or standby function still works
 *
 * Critical spares: parts each site must hold for its crit A assets of a class.
 * A spare can be limited to one model, since fleets standardize equipment.
 */
import type { Craft, Criticality, PmStrategy } from "@/types/domain";

export interface PmTaskDef {
  /** Unique within the class; the full code is CLASS-PMnn. */
  n: number;
  title: string;
  strategy: PmStrategy;
  craft: Craft;
  crew?: number;
  hours: number;
  intervalDays: number;
  /** Shorter interval for crit A assets, when it differs. */
  intervalDaysCritA?: number;
  criticalities: Criticality[];
  /** Failure mode codes from the class this task prevents or detects. */
  modes: string[];
  shutdown?: boolean;
  accept?: string;
}

export interface SpareDef {
  pn: string;
  qty: number;
  /** Only for assets of this model; otherwise every crit A asset of the class. */
  model?: string;
}

export interface ClassPmDef {
  tasks: PmTaskDef[];
  /** Criticalities at which this class is run to failure (no PM). */
  runToFailure?: Criticality[];
  spares?: SpareDef[];
  /** Days within which the same failure mode on the same asset counts as a repeat; null turns it off. Default 90. */
  repeatWindowDays?: number | null;
}

const AB: Criticality[] = ["A", "B"];
const ABC: Criticality[] = ["A", "B", "C"];
const A: Criticality[] = ["A"];

type T = Omit<PmTaskDef, "n">;
const tasks = (...list: T[]): PmTaskDef[] => list.map((t, i) => ({ n: i + 1, ...t }));

export const CLASS_PM: Record<string, ClassPmDef> = {
  "PUMP-CENT": {
    runToFailure: ["C"],
    tasks: tasks(
      { title: "Vibration route: overall and spectrum on both bearing housings", strategy: "condition_based", craft: "mechanical", hours: 0.25, intervalDays: 90, intervalDaysCritA: 30, criticalities: AB, modes: ["VIB", "OHE"], accept: "Within alarm limits and trend; exceedances raise a corrective work order." },
      { title: "Lubrication: oil change or regrease to OEM, check oil condition", strategy: "time_based", craft: "mechanical", hours: 0.5, intervalDays: 180, criticalities: AB, modes: ["OHE", "BRD"] },
      { title: "Operator rounds: seal leakage, noise, bearing temperature by hand", strategy: "condition_based", craft: "operations", hours: 0.1, intervalDays: 7, criticalities: AB, modes: ["ELP"] },
      { title: "Alignment, soft foot and baseplate/grout inspection", strategy: "condition_based", craft: "mechanical", crew: 2, hours: 3, intervalDays: 730, intervalDaysCritA: 365, criticalities: AB, modes: ["STD", "VIB"], shutdown: true, accept: "Within alignment tolerance; soft foot under 0.002 in." },
      { title: "Performance check: flow and head against the pump curve", strategy: "condition_based", craft: "instrumentation", hours: 0.5, intervalDays: 365, criticalities: AB, modes: ["LOO"] },
    ),
    spares: [
      { pn: "MX-BRG-22220", qty: 1, model: "HSC 10x12-17" },
      { pn: "MX-BRG-7318", qty: 1, model: "HSC 10x12-17" },
      { pn: "MX-SEAL-3375C", qty: 1, model: "HSC 10x12-17" },
    ],
  },
  "PUMP-PD": {
    tasks: tasks(
      { title: "Calibration column draw-down at setpoint", strategy: "condition_based", craft: "operations", hours: 0.25, intervalDays: 30, intervalDaysCritA: 7, criticalities: AB, modes: ["ERO", "HIO"], accept: "Within 5% of setpoint." },
      { title: "Wet end rebuild: diaphragm and check valves", strategy: "time_based", craft: "mechanical", hours: 1.5, intervalDays: 365, criticalities: AB, modes: ["ERO", "ELP"], shutdown: true },
      { title: "Leak and containment inspection", strategy: "condition_based", craft: "operations", hours: 0.1, intervalDays: 7, criticalities: ABC, modes: ["ELP"] },
      { title: "Start test of the standby feed", strategy: "failure_finding", craft: "operations", hours: 0.25, intervalDays: 30, criticalities: A, modes: ["FTS"] },
    ),
    spares: [{ pn: "MX-DMP-50-KIT", qty: 1, model: "DMP-50" }],
  },
  "MOTOR-IND": {
    runToFailure: ["C"],
    tasks: tasks(
      { title: "Vibration and temperature route with the driven equipment", strategy: "condition_based", craft: "mechanical", hours: 0.25, intervalDays: 90, intervalDaysCritA: 30, criticalities: AB, modes: ["VIB", "OHE"] },
      { title: "Regrease bearings to OEM quantity and interval", strategy: "time_based", craft: "mechanical", hours: 0.25, intervalDays: 180, criticalities: AB, modes: ["OHE"] },
      { title: "Insulation resistance and polarization index test", strategy: "condition_based", craft: "electrical", hours: 1, intervalDays: 365, criticalities: A, modes: ["INS", "FTS"], shutdown: true, accept: "IR and PI trend stable and above minimum." },
      { title: "Current balance and protection trip history review", strategy: "condition_based", craft: "electrical", hours: 0.25, intervalDays: 90, criticalities: A, modes: ["UST"] },
    ),
  },
  VFD: {
    runToFailure: ["C"],
    tasks: tasks(
      { title: "Clean heatsink, replace filters, check cooling fans", strategy: "time_based", craft: "electrical", hours: 1, intervalDays: 180, criticalities: AB, modes: ["OHE"], shutdown: true },
      { title: "Fault log, DC bus ripple and run-command response review", strategy: "condition_based", craft: "electrical", hours: 0.5, intervalDays: 90, criticalities: AB, modes: ["UST", "PDE", "FTS"] },
      { title: "Replace DC bus capacitors and fans at OEM service life", strategy: "time_based", craft: "electrical", hours: 4, intervalDays: 2555, criticalities: A, modes: ["PDE"], shutdown: true },
    ),
    spares: [{ pn: "MX-ELEC-FAN-VFD", qty: 1, model: "VFD-480-400" }],
  },
  "BLOWER-PD": {
    runToFailure: ["C"],
    tasks: tasks(
      { title: "Belt tension, inlet filter and relief valve service", strategy: "time_based", craft: "mechanical", hours: 1, intervalDays: 180, criticalities: AB, modes: ["LOO", "OHE"], shutdown: true },
      { title: "Oil change and seal leak check", strategy: "time_based", craft: "mechanical", hours: 0.5, intervalDays: 365, criticalities: AB, modes: ["ELU", "OHE"] },
      { title: "Vibration route", strategy: "condition_based", craft: "mechanical", hours: 0.25, intervalDays: 90, criticalities: AB, modes: ["VIB"] },
    ),
  },
  "COMP-SCREW": {
    tasks: tasks(
      { title: "4000-hour service: separator, oil filter, air filter, fluid", strategy: "time_based", craft: "mechanical", hours: 3, intervalDays: 180, criticalities: ABC, modes: ["PDE", "UST", "LOO"], shutdown: true },
      { title: "Clean coolers, check thermal valve and load/unload operation", strategy: "time_based", craft: "mechanical", hours: 1, intervalDays: 365, criticalities: AB, modes: ["UST", "LOO"] },
      { title: "Vibration route", strategy: "condition_based", craft: "mechanical", hours: 0.25, intervalDays: 90, criticalities: AB, modes: ["VIB"] },
    ),
    spares: [{ pn: "MX-FLT-SEP-RS75", qty: 1, model: "RS-75" }],
  },
  "FAN-CT": {
    tasks: tasks(
      { title: "Gearbox oil level, vent and leak check", strategy: "condition_based", craft: "mechanical", hours: 0.5, intervalDays: 30, criticalities: ABC, modes: ["ELU"] },
      { title: "Gearbox oil change with oil analysis sample", strategy: "time_based", craft: "mechanical", hours: 1, intervalDays: 365, criticalities: AB, modes: ["BRD"], shutdown: true },
      { title: "Vibration route; blade pitch and tip clearance check", strategy: "condition_based", craft: "mechanical", hours: 0.5, intervalDays: 90, criticalities: AB, modes: ["VIB"] },
      { title: "Fan deck, stack and support structure inspection", strategy: "condition_based", craft: "mechanical", crew: 2, hours: 2, intervalDays: 365, criticalities: ABC, modes: ["STD"], shutdown: true },
    ),
  },
  "SCREEN-TWS": {
    tasks: tasks(
      { title: "Spray wash and differential level check", strategy: "condition_based", craft: "operations", hours: 0.25, intervalDays: 7, criticalities: ABC, modes: ["PLU"] },
      { title: "Drive, chain and shear pin inspection and lubrication", strategy: "time_based", craft: "mechanical", hours: 1, intervalDays: 90, criticalities: ABC, modes: ["BRD"] },
      { title: "Mesh panel and seal inspection during dewatering", strategy: "condition_based", craft: "mechanical", crew: 2, hours: 4, intervalDays: 365, criticalities: AB, modes: ["STD"], shutdown: true },
    ),
  },
  "XFMR-LIQ": {
    tasks: tasks(
      { title: "Dissolved gas and oil quality analysis", strategy: "condition_based", craft: "electrical", hours: 0.5, intervalDays: 365, criticalities: ABC, modes: ["INS", "OHE"] },
      { title: "Visual inspection: gauges, leaks, breathers, cooling", strategy: "condition_based", craft: "electrical", hours: 0.25, intervalDays: 30, criticalities: AB, modes: ["ELU", "OHE"] },
      { title: "Infrared scan under load: bushings, connections, radiators", strategy: "condition_based", craft: "electrical", hours: 0.5, intervalDays: 365, criticalities: AB, modes: ["OHE", "BRD"] },
    ),
  },
  SWGR: {
    tasks: tasks(
      { title: "Infrared scan under load", strategy: "condition_based", craft: "electrical", hours: 1, intervalDays: 365, criticalities: ABC, modes: ["OHE"] },
      { title: "Breaker inspection, trip test, timing and contact resistance", strategy: "condition_based", craft: "electrical", crew: 2, hours: 6, intervalDays: 1095, intervalDaysCritA: 365, criticalities: ABC, modes: ["FTO", "FTC", "OHE"], shutdown: true, accept: "Trip times within curve; contact resistance within OEM limit." },
      { title: "Partial discharge survey", strategy: "condition_based", craft: "electrical", hours: 1, intervalDays: 365, criticalities: AB, modes: ["INS"] },
    ),
  },
  MCC: {
    tasks: tasks(
      { title: "Infrared scan under load", strategy: "condition_based", craft: "electrical", hours: 1, intervalDays: 365, criticalities: ABC, modes: ["OHE"] },
      { title: "Bucket inspection, termination torque and breaker exercise", strategy: "time_based", craft: "electrical", hours: 4, intervalDays: 1095, criticalities: AB, modes: ["FTS", "FTO"], shutdown: true },
    ),
  },
  "GEN-DIESEL": {
    tasks: tasks(
      { title: "Monthly run test under load", strategy: "failure_finding", craft: "electrical", hours: 1, intervalDays: 30, criticalities: ABC, modes: ["FTS", "UST"], accept: "Starts and reaches rated voltage and frequency within the required time; no alarms." },
      { title: "Annual load bank test", strategy: "failure_finding", craft: "electrical", hours: 4, intervalDays: 365, criticalities: AB, modes: ["LOO"] },
      { title: "Fuel sampling and tank water check", strategy: "condition_based", craft: "mechanical", hours: 0.5, intervalDays: 365, intervalDaysCritA: 180, criticalities: AB, modes: ["PDE"] },
      { title: "Engine service: oil, filters, coolant, starting batteries", strategy: "time_based", craft: "mechanical", hours: 4, intervalDays: 365, criticalities: ABC, modes: ["FTS", "UST"] },
    ),
    spares: [{ pn: "MX-GEN-FLT-2500", qty: 2, model: "2500 kW" }],
  },
  "UPS-STATIC": {
    tasks: tasks(
      { title: "OEM annual preventive maintenance under MOP", strategy: "time_based", craft: "contractor", crew: 2, hours: 6, intervalDays: 365, criticalities: ABC, modes: ["PDE", "OHE"], shutdown: true },
      { title: "Infrared scan and event log review", strategy: "condition_based", craft: "electrical", hours: 1, intervalDays: 90, criticalities: AB, modes: ["OHE", "SPO"] },
      { title: "Transfer and runtime test in a maintenance window", strategy: "failure_finding", craft: "electrical", hours: 2, intervalDays: 365, criticalities: A, modes: ["FTF"], shutdown: true },
      { title: "Replace capacitors and fans at OEM service life", strategy: "time_based", craft: "contractor", crew: 2, hours: 6, intervalDays: 1825, criticalities: AB, modes: ["PDE"], shutdown: true },
    ),
    spares: [{ pn: "MX-UPS-FAN-1000", qty: 2, model: "DC-UPS-1000" }],
  },
  "BATT-STRING": {
    tasks: tasks(
      { title: "Quarterly inspection: module voltage, internal resistance, connections, thermal scan", strategy: "condition_based", craft: "electrical", hours: 2, intervalDays: 90, criticalities: ABC, modes: ["PDE", "STD", "OHE"] },
      { title: "Capacity (discharge) test", strategy: "failure_finding", craft: "electrical", crew: 2, hours: 8, intervalDays: 1825, criticalities: AB, modes: ["LOO"], shutdown: true },
    ),
  },
  STS: {
    tasks: tasks(
      { title: "Infrared scan and cooling fan inspection", strategy: "condition_based", craft: "electrical", hours: 1, intervalDays: 180, criticalities: ABC, modes: ["OHE"] },
      { title: "Transfer test under MOP; event log review", strategy: "failure_finding", craft: "electrical", hours: 2, intervalDays: 365, criticalities: AB, modes: ["FTF", "SPO"] },
    ),
  },
  ATS: {
    tasks: tasks(
      { title: "Monthly transfer test with the generator, timing recorded", strategy: "failure_finding", craft: "electrical", hours: 0.5, intervalDays: 30, criticalities: ABC, modes: ["FTF", "DOP"] },
      { title: "Contact inspection, cleaning and infrared scan", strategy: "time_based", craft: "electrical", hours: 3, intervalDays: 365, criticalities: AB, modes: ["OHE"], shutdown: true },
    ),
  },
  PDU: {
    tasks: tasks(
      { title: "Infrared scan under load", strategy: "condition_based", craft: "electrical", hours: 1, intervalDays: 365, intervalDaysCritA: 180, criticalities: ABC, modes: ["OHE"] },
      { title: "Branch metering verification against a reference meter", strategy: "condition_based", craft: "electrical", hours: 1, intervalDays: 365, criticalities: AB, modes: ["AIR"] },
    ),
  },
  "BOILER-FT": {
    tasks: tasks(
      { title: "Low-water cutoff test", strategy: "failure_finding", craft: "operations", hours: 0.25, intervalDays: 7, criticalities: ABC, modes: ["UST"] },
      { title: "Combustion analysis and burner tune", strategy: "condition_based", craft: "mechanical", hours: 2, intervalDays: 365, intervalDaysCritA: 180, criticalities: ABC, modes: ["PDE", "FTS"] },
      { title: "Annual internal inspection with fireside and waterside cleaning", strategy: "time_based", craft: "mechanical", crew: 2, hours: 16, intervalDays: 365, criticalities: ABC, modes: ["ELP", "PDE"], shutdown: true },
    ),
  },
  VESSEL: {
    tasks: tasks(
      { title: "External inspection; relief valve test or replacement", strategy: "failure_finding", craft: "mechanical", hours: 1, intervalDays: 365, criticalities: ABC, modes: ["ELP", "FTO"] },
      { title: "Thickness survey and internal inspection per jurisdiction", strategy: "condition_based", craft: "contractor", hours: 8, intervalDays: 1825, criticalities: ABC, modes: ["STD"], shutdown: true },
    ),
  },
  TANK: {
    tasks: tasks(
      { title: "Visual and containment inspection", strategy: "condition_based", craft: "operations", hours: 0.25, intervalDays: 30, criticalities: ABC, modes: ["ELP"] },
      { title: "Level instrument verification against manual gauge", strategy: "condition_based", craft: "instrumentation", hours: 0.5, intervalDays: 365, criticalities: AB, modes: ["AIR"] },
      { title: "Formal tank inspection", strategy: "condition_based", craft: "contractor", hours: 4, intervalDays: 1825, criticalities: AB, modes: ["STD"] },
    ),
  },
  "DRYER-DES": {
    runToFailure: ["C"],
    tasks: tasks(
      { title: "Outlet dewpoint check", strategy: "condition_based", craft: "operations", hours: 0.1, intervalDays: 7, criticalities: AB, modes: ["PDE"] },
      { title: "Filter change and switching valve cycle check", strategy: "time_based", craft: "mechanical", hours: 1, intervalDays: 180, criticalities: AB, modes: ["PLU", "FTF"] },
      { title: "Desiccant replacement", strategy: "time_based", craft: "mechanical", crew: 2, hours: 4, intervalDays: 1095, criticalities: AB, modes: ["PDE"], shutdown: true },
    ),
  },
  "VALVE-CHECK": {
    runToFailure: ["B", "C"],
    tasks: tasks(
      { title: "Closure check at pump stop: reverse rotation and standby pressure", strategy: "failure_finding", craft: "operations", hours: 0.25, intervalDays: 90, criticalities: A, modes: ["FTC", "INL"] },
      { title: "Internal inspection of disc, seat and hinge", strategy: "condition_based", craft: "mechanical", crew: 2, hours: 6, intervalDays: 1825, criticalities: A, modes: ["INL", "NOI"], shutdown: true },
    ),
  },
  "VALVE-ACT": {
    runToFailure: ["C"],
    tasks: tasks(
      { title: "Stroke test with timing and position feedback check", strategy: "failure_finding", craft: "instrumentation", hours: 0.5, intervalDays: 180, intervalDaysCritA: 90, criticalities: AB, modes: ["FTO", "FTC", "DOP", "AIR"] },
      { title: "Seat leakage check", strategy: "condition_based", craft: "instrumentation", hours: 0.5, intervalDays: 365, criticalities: A, modes: ["INL"] },
    ),
  },
  ANALYZER: {
    tasks: tasks(
      { title: "Grab sample verification", strategy: "condition_based", craft: "instrumentation", hours: 0.25, intervalDays: 7, criticalities: ABC, modes: ["ERO"] },
      { title: "Calibration with membrane and electrolyte service", strategy: "time_based", craft: "instrumentation", hours: 1, intervalDays: 90, criticalities: ABC, modes: ["ERO", "NOO"] },
      { title: "Sample line and flow cell cleaning", strategy: "time_based", craft: "instrumentation", hours: 0.5, intervalDays: 30, criticalities: AB, modes: ["PLU"] },
    ),
    spares: [{ pn: "MX-CLA-MEMB", qty: 1, model: "CLA-2" }],
  },
  "BMS-CTRL": {
    tasks: tasks(
      { title: "Point-to-point verification of critical points", strategy: "condition_based", craft: "process_controls", hours: 4, intervalDays: 365, criticalities: ABC, modes: ["AIR"] },
      { title: "Alarm and sequence of operations test", strategy: "failure_finding", craft: "process_controls", hours: 2, intervalDays: 365, criticalities: AB, modes: ["FTF"] },
      { title: "Communication health and firmware review", strategy: "condition_based", craft: "process_controls", hours: 1, intervalDays: 90, criticalities: AB, modes: ["NOO"] },
    ),
  },
  CHILLER: {
    tasks: tasks(
      { title: "Log review: approach temperatures, pressures, kW per ton", strategy: "condition_based", craft: "operations", hours: 0.25, intervalDays: 7, criticalities: ABC, modes: ["PDE"] },
      { title: "Refrigerant leak check", strategy: "condition_based", craft: "mechanical", hours: 1, intervalDays: 90, criticalities: ABC, modes: ["ELU"] },
      { title: "OEM annual inspection with oil analysis", strategy: "time_based", craft: "contractor", hours: 8, intervalDays: 365, criticalities: ABC, modes: ["PDE", "FTS", "UST"], shutdown: true },
      { title: "Condenser tube cleaning", strategy: "time_based", craft: "mechanical", crew: 2, hours: 10, intervalDays: 365, criticalities: ABC, modes: ["UST", "PDE"], shutdown: true },
    ),
  },
  CRAH: {
    tasks: tasks(
      { title: "Filter change", strategy: "time_based", craft: "mechanical", hours: 0.5, intervalDays: 90, criticalities: ABC, modes: ["PLU"] },
      { title: "Fan, chilled water valve and controls check", strategy: "condition_based", craft: "mechanical", hours: 1, intervalDays: 180, criticalities: ABC, modes: ["BRD", "FTF"] },
      { title: "Leak detection test and condensate check", strategy: "failure_finding", craft: "mechanical", hours: 0.5, intervalDays: 180, criticalities: AB, modes: ["ELP"] },
    ),
    spares: [
      { pn: "MX-FAN-CRAH-EC", qty: 1, model: "CW-150" },
      { pn: "MX-FLT-CRAH-M8", qty: 2, model: "CW-150" },
    ],
  },
  CDU: {
    tasks: tasks(
      { title: "Coolant sampling: conductivity, pH, inhibitor, biological", strategy: "condition_based", craft: "mechanical", hours: 0.5, intervalDays: 90, intervalDaysCritA: 30, criticalities: ABC, modes: ["PDE"] },
      { title: "Strainer and filter differential check; element change", strategy: "time_based", craft: "mechanical", hours: 1, intervalDays: 180, criticalities: ABC, modes: ["LOO"] },
      { title: "Pump changeover and redundancy test under MOP", strategy: "failure_finding", craft: "mechanical", hours: 1, intervalDays: 90, criticalities: AB, modes: ["BRD"] },
      { title: "Leak inspection of CDU, manifolds and quick disconnects", strategy: "condition_based", craft: "mechanical", hours: 0.5, intervalDays: 30, criticalities: ABC, modes: ["ELP"] },
    ),
    spares: [
      { pn: "MX-CDU-STRN-50", qty: 2, model: "CDU-1000" },
      { pn: "MX-CDU-PG25-5G", qty: 2, model: "CDU-1000" },
    ],
  },
  "FIRE-SUPP": {
    tasks: tasks(
      { title: "Quarterly inspection and supervisory checks", strategy: "condition_based", craft: "contractor", hours: 2, intervalDays: 90, criticalities: ABC, modes: ["PDE"] },
      { title: "Annual functional test and agent check", strategy: "failure_finding", craft: "contractor", hours: 6, intervalDays: 365, criticalities: ABC, modes: ["FTF", "SPO"] },
    ),
  },
  CABINET: {
    runToFailure: ["C"],
    tasks: tasks(
      { title: "Thermal and airflow survey: inlet temperatures, blanking, containment", strategy: "condition_based", craft: "instrumentation", hours: 1, intervalDays: 180, criticalities: AB, modes: ["OHE"] },
      { title: "Rack sensor and power meter verification", strategy: "condition_based", craft: "instrumentation", hours: 0.5, intervalDays: 365, criticalities: AB, modes: ["AIR"] },
      { title: "Physical inspection: doors, rails, bracing, grounding", strategy: "condition_based", craft: "electrical", hours: 0.5, intervalDays: 365, criticalities: AB, modes: ["STD"] },
    ),
  },
  "CABLE-TRAY": {
    tasks: tasks(
      { title: "Pathway walkdown: supports, drop-outs, fill and labels", strategy: "condition_based", craft: "contractor", hours: 1, intervalDays: 365, criticalities: ABC, modes: ["STD", "PDE", "LBL"] },
      { title: "Bonding continuity check", strategy: "condition_based", craft: "electrical", hours: 1, intervalDays: 1095, criticalities: ABC, modes: ["GRD"] },
    ),
  },
  CABLE: {
    runToFailure: ["B", "C"],
    tasks: tasks(
      { title: "Link health review: optical power and interface error trend", strategy: "condition_based", craft: "instrumentation", hours: 0.25, intervalDays: 90, criticalities: A, modes: ["PDE", "NOO"] },
    ),
    spares: [
      { pn: "MX-FIB-MPO24-OS2-45M", qty: 1 },
      { pn: "MX-FIB-MPO24-OS2-30M", qty: 1 },
    ],
  },
};

export function pmTaskCode(classCode: string, n: number): string {
  return `${classCode}-PM${String(n).padStart(2, "0")}`;
}
