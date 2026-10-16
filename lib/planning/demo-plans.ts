/**
 * Scripted Planning Mode for the public demo (no API key needed).
 *
 * These are hand-written plans and replies for the fictional plant, written
 * the way an experienced planner would want Claude to respond. With
 * ANTHROPIC_API_KEY set, Planning Mode uses Claude instead and none of this
 * runs. The scripts show the interaction model: draft, then refine with
 * evidence from site history.
 */
import type { JobPlan } from "./plan-schema";

export interface DemoTurn {
  /** Lowercase keywords; a planner message containing any of them triggers this turn. */
  match: string[];
  /** Suggested prompt shown as a chip in the UI. */
  prompt: string;
  reply: string;
  /** Returns the revised plan, or null if the turn does not change it. */
  revise: ((plan: JobPlan) => JobPlan) | null;
}

export interface DemoScript {
  intro: string;
  plan: JobPlan;
  turns: DemoTurn[];
}

// ----------------------------------------------------------------------------
// WO-26-1031  P-201B inboard bearing high vibration and temperature
// ----------------------------------------------------------------------------

const p201bPlan: JobPlan = {
  summary:
    "Take high-service pump B out of service with pump A on duty, replace both bearings, find the cause of the inboard failure, correct soft foot, laser align and prove it out under load.",
  likely_cause:
    "Inboard bearing distress. Evidence: inboard overall vibration rose from 0.14 to 0.21 in/s by the last route (WO-26-1012) and is now 0.42 in/s; bearing temperature 188 °F against about 150 °F typical; audible growl; fine metallic sheen in the drained oil. The sister pump P-201A failed the same way, and its debrief tied the spalling to misalignment from uncorrected soft foot (WO-26-1009). Misalignment is the leading hypothesis; lubrication is second.",
  requires_shutdown: true,
  estimated_duration_hours: 14,
  permits: ["Energy control (LOTO), group lockout", "Lift plan for upper casing half"],
  hazards: [
    { hazard: "Reverse rotation if the discharge check valve passes", control: "Close and lock the discharge isolation valve; verify the shaft is stationary before removing the coupling guard." },
    { hazard: "Stored pressure and water in the casing", control: "Open casing drain and vent, verify zero pressure on the casing gauge before breaking the split line." },
    { hazard: "Stored energy in the drive DC bus", control: "Wait the posted discharge time on VFD-201B and test for absence of voltage at the motor terminal box." },
    { hazard: "Suspended load during upper casing lift", control: "Confirm casing half weight from the OEM drawing; use the 5-ton chain fall and rated rigging; no one under the load." },
    { hazard: "Hot bearing housings and heated bearings", control: "Let housings cool; heat-resistant gloves when handling induction-heated bearings." },
  ],
  isolation_points: [
    { tag: "BRP-HSP-VFD-201B", energy: "electrical", method: "Open drive input disconnect, lock and tag; test for absence of voltage at motor terminals." },
    { tag: "P-201B suction isolation valve", energy: "pressure", method: "Close, chain and lock." },
    { tag: "P-201B discharge isolation valve", energy: "pressure", method: "Close, chain and lock; holds back system pressure behind check valve V-205 side." },
    { tag: "P-201B casing drain and vent", energy: "pressure", method: "Open and leave open; confirms zero pressure and drains casing." },
  ],
  tasks: [
    { seq: 10, description: "Confirm P-201A is on duty and healthy with operations; remove P-201B from service, drain, apply group lockout and verify isolation", craft: "operations", crew_size: 1, est_hours: 1.5, safety_note: "Try-start from local and SCADA after locks are on.", acceptance_criteria: "Zero pressure on casing gauge; no start from either control point." },
    { seq: 20, description: "Remove coupling guard and spacer; record as-found alignment and check soft foot on all motor feet", craft: "mechanical", crew_size: 2, est_hours: 1.5, safety_note: null, acceptance_criteria: "As-found readings recorded in the work order." },
    { seq: 30, description: "Unbolt and lift upper casing half; lift out rotating element to the laydown area", craft: "mechanical", crew_size: 2, est_hours: 3, safety_note: "5-ton chain fall per WO-26-1009 debrief; the 2-ton was undersized.", acceptance_criteria: null },
    { seq: 40, description: "Remove both bearings; inspect and photograph races; keep failed bearing for analysis; measure shaft and housing fits", craft: "mechanical", crew_size: 2, est_hours: 2, safety_note: null, acceptance_criteria: "Fits within OEM tolerance or flagged before reassembly." },
    { seq: 50, description: "Install new bearings with induction heater; set end float per OEM", craft: "mechanical", crew_size: 2, est_hours: 2, safety_note: "No hammering on rolling elements.", acceptance_criteria: "End float within OEM range." },
    { seq: 60, description: "Reinstall rotating element; new split-line gasket; torque casing bolts in sequence", craft: "mechanical", crew_size: 2, est_hours: 2, safety_note: null, acceptance_criteria: "Rotor turns freely by hand." },
    { seq: 70, description: "Correct soft foot, then laser align motor to pump; record as-left", craft: "mechanical", crew_size: 2, est_hours: 2, safety_note: null, acceptance_criteria: "Soft foot under 0.002 in on every foot; offset within 0.002 in and angularity within 0.5 mil/in at 1,800 rpm, or the site table if tighter." },
    { seq: 80, description: "Fill bearing housings with ISO VG 68 to the sight glass mark; reinstall coupling spacer and guard", craft: "mechanical", crew_size: 1, est_hours: 0.5, safety_note: null, acceptance_criteria: null },
    { seq: 90, description: "Remove locks, controlled start on VFD, monitor bearings for one hour under load", craft: "operations", crew_size: 1, est_hours: 1.5, safety_note: null, acceptance_criteria: "Inboard and outboard overall vibration under 0.15 in/s; bearing temperatures stable under 160 °F after one hour." },
  ],
  parts: [
    { part_number: "MX-BRG-22220", description: "Spherical roller bearing 22220 E", qty: 1 },
    { part_number: "MX-BRG-7318", description: "Angular contact bearing pair 7318 BECBM", qty: 1 },
    { part_number: "MX-GSK-HSC12", description: "Casing split-line gasket kit", qty: 1 },
    { part_number: "MX-SHIM-KIT", description: "Stainless shim kit", qty: 1 },
    { part_number: "MX-OIL-ISO68", description: "Turbine oil ISO VG 68, 5 gal", qty: 1 },
  ],
  tools: ["Laser shaft alignment system", "Induction bearing heater", "5-ton chain fall and rated slings", "Dial indicator for end float and soft foot", "Torque wrench"],
  references: [
    { source: "WO-26-1009 (P-201A bearing replacement)", note: "Ran 15.5 h vs 12 planned; found soft foot; needed 5-ton chain fall. Built into steps 20, 30 and 70 and the hours." },
    { source: "WO-26-1012 (P-201B oil change and route)", note: "Inboard vibration trend and metallic sheen in oil support the bearing diagnosis." },
    { source: "Rotating equipment practice (layer 1)", note: "Soft foot before alignment; tolerance targets; bearing mounting." },
    { source: "Energy control (layer 1)", note: "Reverse rotation and stored pressure on pumps; verification of isolation." },
  ],
  open_questions: [
    "Walk down the isolation points against the site energy control procedure for P-201B.",
    "Confirm upper casing half weight from the OEM drawing before the lift.",
    "Is any other work planned on P-201A or the high-service header during this window?",
  ],
};

const p201bTurns: DemoTurn[] = [
  {
    match: ["seal", "weep", "leak"],
    prompt: "The seal is weeping too. Should we replace it while we're in there?",
    reply:
      "Yes. The rotating element is coming out at step 30 anyway, so a seal swap adds about 2 crew-hours instead of a second outage later. I added it as step 55 and added the cartridge seal to the parts list.\n\nOne catch: the storeroom shows only one MX-SEAL-3375C available, and a split-case pump has two seals. I planned the inboard seal (the one weeping) and added an open question: order a second seal now and either hold the job for it or put the outboard seal on the watch list. Duration goes from 14 to 15 hours.",
    revise: (plan): JobPlan => ({
      ...plan,
      estimated_duration_hours: plan.estimated_duration_hours + 1,
      tasks: [
        ...plan.tasks.filter((t) => t.seq < 60),
        { seq: 55, description: "Replace inboard cartridge mechanical seal; check sleeve condition and shaft runout at the seal", craft: "mechanical" as const, crew_size: 2, est_hours: 1, safety_note: "Remove cartridge setting clips before start-up.", acceptance_criteria: "Shaft runout at seal under 0.002 in TIR." },
        ...plan.tasks.filter((t) => t.seq >= 60),
      ].sort((a, b) => a.seq - b.seq),
      parts: [...plan.parts, { part_number: "MX-SEAL-3375C", description: "Cartridge mechanical seal, 3.375 in shaft", qty: 1 }],
      open_questions: [
        ...plan.open_questions,
        "Only one cartridge seal in stock. Order a second and decide: wait for it, or replace inboard only and add the outboard seal to the watch list.",
      ],
    }),
  },
  {
    match: ["pump a", "backup", "standby", "redundan", "risk"],
    prompt: "Pump A is our only backup. How do we protect it during the job?",
    reply:
      "Fair concern. With B open, A carries firm capacity alone for about 15 hours. I added step 5: take a vibration and temperature baseline on P-201A before B is isolated, so you know A is healthy before you commit. If A is above its alert level, hold the job.\n\nI also added two open questions for operations: agree a contingency if A trips (how fast can B be boxed back up after step 30, which is realistically 4 to 6 hours), and freeze any other work on A and its drive for the window.",
    revise: (plan): JobPlan => ({
      ...plan,
      tasks: [
        { seq: 5, description: "Baseline P-201A: overall vibration both bearings and bearing temperatures; confirm under alert levels before isolating B", craft: "instrumentation", crew_size: 1, est_hours: 0.5, safety_note: null, acceptance_criteria: "P-201A below alert levels; otherwise hold the job." },
        ...plan.tasks,
      ],
      open_questions: [
        ...plan.open_questions,
        "Agree with operations a contingency if P-201A trips mid-job, and how long B takes to reassemble from each step.",
        "Freeze other work on P-201A and VFD for the job window.",
      ],
    }),
  },
  {
    match: ["confirm", "field", "walkdown", "before i commit", "check"],
    prompt: "What do I need to confirm in the field before I commit?",
    reply:
      "Four things, all in the open questions panel:\n\n1. Walk the isolation points with operations against the written procedure. I named the valves by function because the drawings don't carry valve tags.\n2. Casing half weight from the OEM drawing, so the lift plan is right the first time.\n3. Whether there's a seal flush or cooling line to the bearing housings that needs isolating. The asset record doesn't say.\n4. Stock: bearings and gasket are available, but check the seal count if you added the seal.\n\nOnce those are answered, the plan is ready to commit and the parts will reserve automatically.",
    revise: null,
  },
];

// ----------------------------------------------------------------------------
// WO-26-1033  Hypochlorite metering pump output low
// ----------------------------------------------------------------------------

const mp401Plan: JobPlan = {
  summary: "Rebuild the wet end of hypochlorite metering pump MP-401 (diaphragm and check valves) and prove output with a drawdown test.",
  likely_cause:
    "Worn diaphragm or scaled check valves. Evidence: pump delivers about 70% of rated flow at 100% stroke on drawdown; hypochlorite scale on check balls is a common cause. No rebuild on record since installation.",
  requires_shutdown: true,
  estimated_duration_hours: 3,
  permits: ["Energy control (LOTO)", "Line break: chemical"],
  hazards: [
    { hazard: "Sodium hypochlorite contact and off-gassing", control: "Face shield, goggles, chemical gloves and apron; confirm eyewash and shower are within reach; flush wet end with water before opening." },
    { hazard: "Loss of disinfection while the pump is down", control: "Operations confirms the backup feed path and increases residual monitoring during the job." },
  ],
  isolation_points: [
    { tag: "BRP-CHM-MP-401", energy: "electrical", method: "Lock out at local disconnect; try-start." },
    { tag: "MP-401 suction and discharge valves", energy: "chemical", method: "Close and lock; relieve discharge pressure through the bleed valve to the drain." },
  ],
  tasks: [
    { seq: 10, description: "Operations places backup feed in service and confirms residual is stable; isolate and lock out MP-401", craft: "operations", crew_size: 1, est_hours: 0.5, safety_note: null, acceptance_criteria: "Residual within target on the backup feed." },
    { seq: 20, description: "Flush the wet end with water; relieve pressure; remove pump head", craft: "instrumentation", crew_size: 1, est_hours: 0.5, safety_note: "Full chemical PPE until the head is flushed and off.", acceptance_criteria: null },
    { seq: 30, description: "Replace diaphragm and suction and discharge check valve assemblies from the kit; clean scale from the head", craft: "instrumentation", crew_size: 1, est_hours: 1, safety_note: null, acceptance_criteria: null },
    { seq: 40, description: "Reassemble, prime, return to service; run a drawdown test at 100% stroke", craft: "instrumentation", crew_size: 1, est_hours: 1, safety_note: null, acceptance_criteria: "Output within 5% of rated flow on the calibration column." },
  ],
  parts: [{ part_number: "MX-DMP-50-KIT", description: "Diaphragm and check valve kit, DMP-50", qty: 1 }],
  tools: ["Calibration column and stopwatch", "Chemical PPE set"],
  references: [
    { source: "Utility operations (layer 2)", note: "Chemical feed PPE, flushing before opening, residual monitoring." },
  ],
  open_questions: ["Confirm the backup feed path and who monitors residual during the job.", "Only one rebuild kit in stock; reorder after this job."],
};

// ----------------------------------------------------------------------------
// WO-26-1035  Boiler feedwater pump seal leak
// ----------------------------------------------------------------------------

const p502Plan: JobPlan = {
  summary: "Replace the mechanical seal on boiler feedwater pump P-502 with the boiler off line and cooled, and confirm a dry seal at operating temperature.",
  likely_cause:
    "Seal face damage, possibly from flashing at the faces if the flush is restricted. A steady stream rather than a drip suggests face or secondary seal failure, not a setting issue.",
  requires_shutdown: true,
  estimated_duration_hours: 8,
  permits: ["Energy control (LOTO)", "Line break: hot water"],
  hazards: [
    { hazard: "Hot condensate and burns", control: "Boiler off line per shutdown procedure; cool the pump below 120 °F and verify by surface thermometer." },
    { hazard: "Stored pressure from the deaerator", control: "Close and lock suction from the DA and discharge to the boiler; vent the casing to zero." },
  ],
  isolation_points: [
    { tag: "BRP-BLR-P-502", energy: "electrical", method: "Lock out motor starter; test for absence of voltage at the motor." },
    { tag: "P-502 suction valve from DA-503", energy: "thermal / pressure", method: "Close, chain and lock." },
    { tag: "P-502 discharge valve to B-501", energy: "pressure", method: "Close, chain and lock; open casing vent." },
  ],
  tasks: [
    { seq: 10, description: "Take boiler B-501 off line per procedure; cool, isolate and lock out P-502", craft: "operations", crew_size: 1, est_hours: 2, safety_note: null, acceptance_criteria: "Casing below 120 °F and zero pressure." },
    { seq: 20, description: "Remove coupling and motor as needed for seal access; remove old seal; inspect sleeve and flush line", craft: "mechanical", crew_size: 2, est_hours: 2, safety_note: null, acceptance_criteria: "Flush line clear end to end." },
    { seq: 30, description: "Install new cartridge seal; remove setting clips; reinstall coupling and check alignment", craft: "mechanical", crew_size: 2, est_hours: 2.5, safety_note: "Never run the seal dry.", acceptance_criteria: "Alignment within site tolerance." },
    { seq: 40, description: "Fill and vent the pump; return boiler to service; check the seal at operating temperature", craft: "operations", crew_size: 1, est_hours: 1.5, safety_note: null, acceptance_criteria: "No visible leakage at the seal after 30 minutes at temperature." },
  ],
  parts: [{ part_number: "MX-SEAL-1625C", description: "Cartridge mechanical seal, 1.625 in shaft, high temp", qty: 1 }],
  tools: ["Surface thermometer", "Dial indicator alignment set"],
  references: [
    { source: "Utility operations (layer 2)", note: "Feedwater pumps run hot; seal temperature rating and flush plan." },
    { source: "Energy control (layer 1)", note: "Thermal and pressure isolation." },
  ],
  open_questions: [
    "The high-temp seal shows zero available in the storeroom. Order it and confirm lead time before scheduling.",
    "Is there a second feedwater pump or is this a boiler outage? The asset record shows only P-502.",
  ],
};

// ----------------------------------------------------------------------------
// WO-26-1036  Standby generator annual load bank test
// ----------------------------------------------------------------------------

const gen703Plan: JobPlan = {
  summary: "Run the annual 2-hour load bank test on standby generator GEN-703 with a contractor-supplied load bank, plus annual inspection items.",
  likely_cause: "Not applicable: scheduled preventive work.",
  requires_shutdown: false,
  estimated_duration_hours: 5,
  permits: ["Electrical: load bank connection (energized work boundary)"],
  hazards: [
    { hazard: "Arc flash at the load bank connection point", control: "Connect with the generator off and locked; label PPE for any energized check." },
    { hazard: "Plant left without automatic standby during the test", control: "Operations aware; transfer switch status agreed in advance; test in a low-risk window." },
    { hazard: "Hot exhaust and load bank discharge air", control: "Barricade the exhaust and load bank discharge areas." },
  ],
  isolation_points: [
    { tag: "BRP-ELE-GEN-703", energy: "electrical", method: "Engine control to OFF, battery charger off, lock out while connecting load bank cables." },
  ],
  tasks: [
    { seq: 10, description: "Pre-test inspection: fluids, belts, hoses, battery condition, fuel level", craft: "electrical", crew_size: 1, est_hours: 1, safety_note: null, acceptance_criteria: null },
    { seq: 20, description: "Lock out, connect contractor load bank at the test connection point", craft: "contractor", crew_size: 2, est_hours: 1, safety_note: null, acceptance_criteria: null },
    { seq: 30, description: "Run stepped load test for 2 hours; record voltage, frequency, kW, coolant temperature and oil pressure every 15 minutes", craft: "electrical", crew_size: 1, est_hours: 2.5, safety_note: null, acceptance_criteria: "Stable voltage and frequency at each load step; no alarms." },
    { seq: 40, description: "Cool-down run, disconnect load bank, return generator to AUTO and confirm with operations", craft: "electrical", crew_size: 1, est_hours: 0.5, safety_note: null, acceptance_criteria: "Generator in AUTO, transfer switch normal." },
  ],
  parts: [{ part_number: null, description: "Engine oil and filter set (OEM), if due by hours", qty: 1 }],
  tools: ["Contractor load bank and cables", "Power quality meter"],
  references: [{ source: "Utility operations (layer 2)", note: "Standby power testing and NFPA 110 as the usual reference." }],
  open_questions: ["Book the load bank contractor and confirm cable lengths to the connection point.", "Check engine hours to see if the oil service is due."],
};

export const DEMO_SCRIPTS: Record<string, DemoScript> = {
  "WO-26-1031": {
    intro:
      "Here's a first draft. The big input is history: P-201A had the same failure in the spring (WO-26-1009) and overran by 3.5 hours because nobody planned for soft foot or the heavier chain fall. I built both into this plan, so it's 14 hours, not the 12 that job was planned at.\n\nThe vibration trend on B (0.14 to 0.21 to 0.42 in/s) and the metallic sheen in the last oil change point at the inboard bearing. I listed misalignment as the leading cause, since that's what the sister pump showed. Bearings, gasket and shims are all in stock.",
    plan: p201bPlan,
    turns: p201bTurns,
  },
  "WO-26-1033": {
    intro:
      "Drafted a wet-end rebuild. 70% output at full stroke on a drawdown is the classic signature of a worn diaphragm or scaled check valves on hypochlorite. The kit is in stock (one on hand). The main planning risk is disinfection while the pump is down, so step 10 puts the backup feed in service first.",
    plan: mp401Plan,
    turns: [],
  },
  "WO-26-1035": {
    intro:
      "Drafted a seal replacement with the boiler off line. Flag before you go further: the high-temp seal (MX-SEAL-1625C) shows zero available, so this can't be scheduled until it's ordered. I also couldn't find a second feedwater pump in the asset registry. If there isn't one, this is a boiler outage and operations needs to plan around it.",
    plan: p502Plan,
    turns: [],
  },
  "WO-26-1036": {
    intro:
      "Drafted the annual load bank test with a contractor load bank. No storeroom parts are needed unless the engine is due for its oil service by hours; that's an open question. The key coordination item is that the plant has no automatic standby while the unit is under test.",
    plan: gen703Plan,
    turns: [],
  },
};

/** A minimal plan for work orders without a script, built from the work order itself. */
export function genericDemoPlan(title: string, assetLabel: string | null, shutdown: boolean): JobPlan {
  return {
    summary: `${title}${assetLabel ? ` on ${assetLabel}` : ""}: inspect, repair and return to service.`,
    likely_cause: "Unknown until inspected. The demo planner only has the work order text; live Planning Mode reasons over site history and stock.",
    requires_shutdown: shutdown,
    estimated_duration_hours: 4,
    permits: ["Energy control (LOTO)"],
    hazards: [{ hazard: "Unexpected energization", control: "Isolate, lock and verify before work." }],
    isolation_points: assetLabel ? [{ tag: assetLabel, energy: "electrical", method: "Lock out at the starter or disconnect; try-start." }] : [],
    tasks: [
      { seq: 10, description: "Coordinate with operations; isolate and verify", craft: "operations", crew_size: 1, est_hours: 0.5, safety_note: null, acceptance_criteria: null },
      { seq: 20, description: "Inspect and diagnose; record as-found condition", craft: "mechanical", crew_size: 1, est_hours: 1.5, safety_note: null, acceptance_criteria: null },
      { seq: 30, description: "Repair or replace failed components", craft: "mechanical", crew_size: 1, est_hours: 1.5, safety_note: null, acceptance_criteria: null },
      { seq: 40, description: "Return to service and verify operation", craft: "operations", crew_size: 1, est_hours: 0.5, safety_note: null, acceptance_criteria: "Operates normally under load." },
    ],
    parts: [],
    tools: [],
    references: [],
    open_questions: ["Field walkdown to confirm scope, isolation points and parts."],
  };
}

export const DEMO_FALLBACK_REPLY =
  "You're on the public demo, where Planning Mode runs a scripted planner so it works without an API key. It can't reason over free text, so the plan is unchanged. Try one of the suggested prompts, or edit the plan directly. With an Anthropic API key configured, this message would go to Claude with the full site context.";
