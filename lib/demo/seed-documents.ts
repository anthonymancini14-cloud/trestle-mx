/**
 * Controlled documents for the demo sites (TMX-026). All content is invented
 * for the fictional sites; manufacturers are "Generic". Document numbers are
 * assigned in the order below, per site and type (BRP-PRC-0001, -0002 …), so
 * bodies can cite each other by number.
 *
 * Revisions: every released revision (no `status`) is approved by `reviewer`;
 * the newest released one is current and the earlier ones are superseded.
 * Work order links (`uses`) are by seed key; views are timed from the start of
 * the work, so each view sees the revision current then.
 */
import type { DocType, WoDocSource } from "@/types/domain";

export interface DocRevDef {
  summary: string;
  by: string;
  reviewer?: string;
  /** When it was written; a released revision is approved a day later. */
  daysAgo: number;
  body?: string;
  file?: { path: string; name: string; mime: string; size: number };
  status?: "draft" | "rejected";
  reviewNote?: string;
}

export interface DocDef {
  type: DocType;
  title: string;
  flocs: string[];
  revs: DocRevDef[];
  obsolete?: { by: string; daysAgo: number; reason: string; replacedBy?: string };
  uses?: { wo: number; source: WoDocSource; by: string; views?: { by?: string; hoursIntoWork: number }[] }[];
}

const svg = (path: string, name: string, size: number) => ({ path, name, mime: "image/svg+xml", size });

// ---------------------------------------------------------------- Basalt Ridge Plant

export const BRP_DOCS: DocDef[] = [
  {
    type: "oem_manual",
    title: "HSC 10x12-17 split-case pump: installation, operation and maintenance",
    flocs: ["BRP-HSP-P-201A", "BRP-HSP-P-201B"],
    revs: [
      {
        summary: "Initial issue, from the vendor's turnover package.",
        by: "Marcus",
        reviewer: "Lena",
        daysAgo: 3600,
        body: `# HSC 10x12-17 horizontal split-case pump

Generic Pump Co. Installation, operation and maintenance manual, excerpts kept for the field.

## Bearings

| Position | Bearing | Lubrication | Normal temperature |
|---|---|---|---|
| Inboard (coupling end) | 22220 spherical roller | Oil bath, ISO VG 68 | 140 to 160 °F |
| Outboard | 7318 angular contact pair | Oil bath, ISO VG 68 | 130 to 150 °F |

## Clearances

| Item | New | Replace at |
|---|---|---|
| Wear ring diametral clearance | 0.018 to 0.022 in | 0.040 in |
| Shaft runout at the sleeve | 0.002 in TIR maximum | |
| Casing split-line gasket | 1/64 in compressed fiber | Every time the casing is opened |

## Torque

| Fastener | Torque |
|---|---|
| Casing split-line bolts, 1-1/8 in | 650 ft-lb, crossing pattern in three passes |
| Bearing housing cap screws | 85 ft-lb |
| Coupling hub set screws | 30 ft-lb |

## Alignment

Align the motor to the pump with a laser tool after the casing is closed and piping is connected. Offset 0.002 in maximum, angularity 0.0005 in/in maximum, at running temperature correction from the data sheet.`,
      },
    ],
  },
  {
    type: "oem_manual",
    title: "RS-75 rotary screw air compressor: service manual",
    flocs: ["BRP-AIR-C-801"],
    revs: [
      {
        summary: "Initial issue.",
        by: "Marcus",
        reviewer: "Lena",
        daysAgo: 3000,
        body: `# RS-75 oil-flooded rotary screw compressor

Generic Compressor Co. service manual excerpts.

## Service intervals

| Interval | Work |
|---|---|
| 2,000 h | Air filter element, check belt tension |
| 4,000 h | Oil, oil filter, separator element, air filter, thermostatic valve check |
| 8,000 h | All 4,000 h work plus minimum pressure valve kit and cooler cleaning |

## High discharge temperature trips

The controller trips the unit at 239 °F discharge temperature. Check in this order:

1. Oil level in the sump sight glass, unit stopped and blown down.
2. Oil cooler fins, air side, for dust and debris.
3. Thermostatic mixing valve: the valve should start opening at 160 °F and be fully open at 185 °F.
4. Oil filter differential pressure: change the filter above 25 psid.
5. Cooling fan rotation and belt tension.

## Fluids

Use the synthetic rotary screw fluid listed on the nameplate. Do not mix fluids.`,
      },
    ],
  },
  {
    type: "drawing",
    title: "High-service pump A general arrangement",
    flocs: ["BRP-HSP-P-201A"],
    revs: [
      { summary: "As-built from the 2014 installation.", by: "Marcus", reviewer: "Lena", daysAgo: 4300, file: svg("/demo-docs/brp-dwg-0001-a.svg", "BRP-DWG-0001 Rev A.svg", 4769) },
      { summary: "Shows the online vibration transmitters added under BRP-MOC-0001.", by: "Marcus", reviewer: "Lena", daysAgo: 900, file: svg("/demo-docs/brp-dwg-0001-b.svg", "BRP-DWG-0001 Rev B.svg", 5837) },
    ],
  },
  {
    type: "drawing",
    title: "MCC-2 one-line diagram",
    flocs: ["BRP-ELE-MCC-702"],
    revs: [{ summary: "Initial issue.", by: "Marcus", reviewer: "Lena", daysAgo: 3800, file: svg("/demo-docs/brp-dwg-0002-a.svg", "BRP-DWG-0002 Rev A.svg", 7624) }],
    uses: [{ wo: 1022, source: "plan", by: "Marcus", views: [{ by: "Alex", hoursIntoWork: 1 }] }],
  },
  {
    type: "specification",
    title: "High-service pumps P-201A and P-201B: data sheet",
    flocs: ["BRP-HSP-P-201A", "BRP-HSP-P-201B", "BRP-HSP-M-201B"],
    revs: [
      {
        summary: "Initial issue.",
        by: "Marcus",
        reviewer: "Lena",
        daysAgo: 4200,
        body: `# High-service pumps P-201A and P-201B

| Item | Value |
|---|---|
| Service | Finished water to distribution |
| Type | Horizontal split case, double suction |
| Model | Generic HSC 10x12-17 |
| Rated flow | 4,200 gpm |
| Rated head | 230 ft |
| Speed | 1,780 rpm |
| Impeller | Bronze, 15.75 in trimmed |
| Seal | Single mechanical, flushed from discharge |
| Motor | 400 hp, 460 V, 1,785 rpm, 449T TEFC |
| Coupling | Gear coupling, 3.5 in spacer |
| Alignment target, cold | Motor 0.004 in high to allow for growth |

Duty and standby: one pump keeps firm capacity, so the other may come out of service for work.`,
      },
    ],
  },
  {
    type: "procedure",
    title: "Air compressor 4000-hour service checklist",
    flocs: ["BRP-AIR-C-801"],
    revs: [
      {
        summary: "Initial issue.",
        by: "Marcus",
        reviewer: "Lena",
        daysAgo: 2500,
        body: `# Air compressor 4000-hour service checklist

- Change oil and oil filter
- Change the separator element
- Change the air filter
- Record hours`,
      },
    ],
    obsolete: { by: "Lena", daysAgo: 380, reason: "Replaced by a full procedure with isolation, blowdown and the thermostatic valve check.", replacedBy: "Air compressor 4000-hour service procedure" },
  },
  {
    type: "procedure",
    title: "Air compressor 4000-hour service procedure",
    flocs: ["BRP-AIR-C-801"],
    revs: [
      {
        summary: "Initial issue; replaces BRP-PRC-0001.",
        by: "Marcus",
        reviewer: "Lena",
        daysAgo: 382,
        body: `# Air compressor C-801: 4000-hour service

References: BRP-OEM-0002 (service manual).

## Before you start

- Plant air header on the backup supply, confirmed with operations.
- Lock out C-801 at the disconnect, close the discharge isolation valve and blow the unit down to 0 psig at the sump gauge.

## Steps

1. Drain the oil warm into the recovery drum. Record the volume.
2. Change the oil filter. Oil the gasket and tighten by hand three-quarters of a turn past contact.
3. Change the separator element. Clean the scavenge line strainer.
4. Change the air filter element and wipe the housing.
5. Fill with the nameplate fluid to the middle of the sight glass.
6. Check the thermostatic mixing valve (see BRP-OEM-0002): it should start opening at 160 °F.
7. Return to service, run 30 minutes loaded and record discharge temperature and oil filter differential.

## Acceptance

Discharge temperature 185 to 205 °F loaded. No leaks. Oil level in the sight glass with the unit running.`,
      },
    ],
    uses: [{ wo: 1025, source: "plan", by: "Marcus" }, { wo: 1049, source: "opened", by: "Devon", views: [{ by: "Devon", hoursIntoWork: 2 }] }],
  },
  {
    type: "procedure",
    title: "Split-case pump bearing replacement",
    flocs: ["BRP-HSP-P-201A", "BRP-HSP-P-201B"],
    revs: [
      {
        summary: "Initial issue.",
        by: "Marcus",
        reviewer: "Lena",
        daysAgo: 1500,
        body: `# Split-case pump bearing replacement

1. Lock out, isolate suction and discharge, drain the casing.
2. Remove the coupling guard and spacer. Unbolt and lift the upper casing half.
3. Pull and replace the inboard and outboard bearings.
4. Close the casing, torque the split line, align.`,
      },
      {
        summary: "Adds torque values, the casing lift and the return-to-service check.",
        by: "Marcus",
        reviewer: "Lena",
        daysAgo: 600,
        body: `# Split-case pump bearing replacement

Applies to P-201A and P-201B. References: BRP-OEM-0001 (manual), BRP-SPC-0001 (data sheet), BRP-DWG-0001 (general arrangement).

## Steps

1. Operations starts the standby pump, then locks out the motor and closes and locks the suction and discharge valves. Drain the casing.
2. Remove the coupling guard and spacer. Match-mark the coupling hubs.
3. Remove the split-line bolts and lift the upper casing half with a 2-ton chain fall.
4. Pull both bearings with the hydraulic puller. Heat new bearings to 230 °F on the induction heater; never with a torch.
5. Set the outboard pair back to back. Fill the housings with ISO VG 68 to the sight glass center.
6. New split-line gasket. Torque the split-line bolts to 650 ft-lb in three passes.
7. Laser align: 0.002 in offset, 0.0005 in/in angularity.

## Return to service

Run 4 hours. Inboard bearing at or below 0.10 in/s overall and 160 °F.`,
      },
      {
        summary: "Adds a soft foot check before alignment and changes the casing lift to a 5-ton chain fall, from the debrief on the P-201A bearing job.",
        by: "Marcus",
        reviewer: "Lena",
        daysAgo: 140,
        body: `# Split-case pump bearing replacement

Applies to P-201A and P-201B. References: BRP-OEM-0001 (manual), BRP-SPC-0001 (data sheet), BRP-DWG-0001 (general arrangement).

## Steps

1. Operations starts the standby pump, then locks out the motor and closes and locks the suction and discharge valves. Drain the casing.
2. Remove the coupling guard and spacer. Match-mark the coupling hubs.
3. Remove the split-line bolts and lift the upper casing half with a **5-ton** chain fall. The 2-ton fall is not rated for the casing half.
4. Pull both bearings with the hydraulic puller. Heat new bearings to 230 °F on the induction heater; never with a torch.
5. Set the outboard pair back to back. Fill the housings with ISO VG 68 to the sight glass center.
6. New split-line gasket. Torque the split-line bolts to 650 ft-lb in three passes.
7. **Check soft foot on all four motor feet before aligning: 0.002 in maximum. Shim and recheck.**
8. Laser align: 0.002 in offset, 0.0005 in/in angularity.

## Return to service

Run 4 hours. Inboard bearing at or below 0.10 in/s overall and 160 °F. Record both in the troubleshooting record.`,
      },
    ],
    uses: [{ wo: 1009, source: "plan", by: "Marcus", views: [{ by: "Jordan", hoursIntoWork: 0.5 }, { by: "Devon", hoursIntoWork: 3 }] }],
  },
  {
    type: "procedure",
    title: "Cooling tower fan gearbox output seal replacement",
    flocs: ["BRP-CTW-F-601"],
    revs: [
      {
        summary: "Initial issue.",
        by: "Marcus",
        reviewer: "Lena",
        daysAgo: 700,
        body: `# Cooling tower fan F-601: gearbox output seal

Scaffold to the fan deck is a separate WCE by the contractor; do not start until the scaffold tag is green.

1. Lock out the fan motor at the MCC and at the local disconnect. Tie off the fan blades.
2. Uncouple the drive shaft at the gearbox input.
3. Drain the gearbox oil and record its condition.
4. Remove the fan hub. Pull the output seal without scoring the shaft.
5. Install the new seal with the installation tool, lip toward the oil.
6. Refill with ISO VG 220 gear oil to the level plug.
7. Run 1 hour and check for leaks at the seal.`,
      },
      {
        summary: "Adds the shaft sleeve option when the seal track is worn, and a torque value for the fan hub.",
        by: "Marcus",
        daysAgo: 2,
        status: "draft",
        body: `# Cooling tower fan F-601: gearbox output seal

Scaffold to the fan deck is a separate WCE by the contractor; do not start until the scaffold tag is green.

1. Lock out the fan motor at the MCC and at the local disconnect. Tie off the fan blades.
2. Uncouple the drive shaft at the gearbox input.
3. Drain the gearbox oil and record its condition.
4. Remove the fan hub. Pull the output seal without scoring the shaft.
5. Inspect the seal track. If it is grooved deeper than 0.005 in, fit a repair sleeve before the new seal.
6. Install the new seal with the installation tool, lip toward the oil.
7. Refit the fan hub; torque the hub bolts to 120 ft-lb.
8. Refill with ISO VG 220 gear oil to the level plug.
9. Run 1 hour and check for leaks at the seal.`,
      },
    ],
    uses: [{ wo: 1041, source: "plan", by: "Marcus" }],
  },
  {
    type: "moc",
    title: "Online vibration transmitters on the high-service pump bearing housings",
    flocs: ["BRP-HSP-P-201A", "BRP-HSP-P-201B"],
    revs: [
      {
        summary: "Approved change.",
        by: "Marcus",
        reviewer: "Chris",
        daysAgo: 920,
        body: `# Management of change: online vibration on P-201A and P-201B

## Change

Add a 4-20 mA vibration transmitter to the inboard and outboard bearing housings of both high-service pumps, wired to the plant control system with alarm at 0.25 in/s and high alarm at 0.40 in/s.

## Why

Both pumps are criticality A. Monthly route readings missed a fast bearing failure on P-201B; continuous readings give operations time to switch pumps.

## Review

| Area | Finding |
|---|---|
| Process safety | No change to the pressure boundary |
| Electrical | New loops from the existing I/O panel spare channels |
| Operations | Alarm response added to the operator rounds |
| Maintenance | Transmitters added to the instrument PM program |
| Documents | BRP-DWG-0001 to Rev B |

## Approval

Approved by the site admin after review by operations, maintenance and engineering.`,
      },
    ],
  },
];

// ---------------------------------------------------------------- Cedar Flats Data Center

export const DC_DOCS: DocDef[] = [
  {
    type: "oem_manual",
    title: "CRAH EC plug fan module: service manual",
    flocs: ["CFD-DH1-CRAH-01", "CFD-DH1-CRAH-02", "CFD-DH1-CRAH-03", "CFD-DH1-CRAH-04"],
    revs: [
      {
        summary: "Initial issue, from commissioning turnover.",
        by: "Owen",
        reviewer: "Hana",
        daysAgo: 700,
        body: `# CRAH EC plug fan module

Generic Air Systems service manual excerpts.

## Fan module replacement

Each CRAH has three EC plug fans. The unit holds airflow on two fans at up to 80% of rated load, so one fan module can be changed with the unit running.

1. Confirm the remaining fans have taken the load: supply air temperature steady at the BMS.
2. Open the fan section door. Turn off the module's isolator; wait 5 minutes for the drive's capacitors to discharge.
3. Unplug the power and Modbus connectors. Remove the four mounting bolts and slide the module out on its rails.
4. Slide in the new module, bolt it, reconnect, and set its Modbus address to match the old one (address label on the frame).
5. Turn on the isolator and confirm at the BMS that all three fans report and share the load.

## Alarms

| Alarm | Meaning |
|---|---|
| Fan fail | Module not running when commanded |
| Fan comm loss | No Modbus reply from the module |
| Fan overtemperature | Drive electronics over 185 °F |`,
      },
    ],
    uses: [{ wo: 2003, source: "opened", by: "Mateo", views: [{ by: "Mateo", hoursIntoWork: 1 }] }],
  },
  {
    type: "oem_manual",
    title: "UPS-500 double-conversion UPS: service manual",
    flocs: ["CFD-ELA-UPS-A1", "CFD-ELA-UPS-A2", "CFD-ELB-UPS-B1", "CFD-ELB-UPS-B2"],
    revs: [
      {
        summary: "Initial issue.",
        by: "Owen",
        reviewer: "Hana",
        daysAgo: 720,
        body: `# UPS-500 double-conversion UPS

Generic Power Systems service manual excerpts. Annual maintenance is done by the OEM field engineer with a site electrician.

## Annual maintenance

1. Transfer the module to maintenance bypass with the facility on the other side (A or B) confirmed healthy.
2. Thermal scan of all terminations under load before transfer.
3. Inspect and clean air filters and fans; replace fans at 5 years.
4. Check DC capacitors for bulging or leakage; replace at 7 years.
5. Download the event log; review alarms since the last visit.
6. Return to double conversion; verify output voltage and load sharing.

## Ratings

| Item | Value |
|---|---|
| Output | 500 kVA, 480 V, 3-phase |
| Battery | 40 x 12 V VRLA per string, one string |
| Bypass | Static, plus external maintenance bypass |`,
      },
    ],
    uses: [{ wo: 2002, source: "plan", by: "Owen", views: [{ by: "Tasha", hoursIntoWork: 0.5 }] }],
  },
  {
    type: "drawing",
    title: "Electrical single-line diagram, A and B sides",
    flocs: ["CFD-MVS-SWGR-01", "CFD-ELA-SWGR-A", "CFD-ELB-SWGR-B", "CFD-ELA-UPS-A1", "CFD-ELA-UPS-A2", "CFD-ELB-UPS-B1", "CFD-ELB-UPS-B2", "CFD-GEN-G-01", "CFD-GEN-G-02"],
    revs: [
      { summary: "Issued for construction.", by: "Owen", reviewer: "Hana", daysAgo: 900, file: svg("/demo-docs/cfd-dwg-0001-a.svg", "CFD-DWG-0001 Rev A.svg", 6187) },
      { summary: "As-built after commissioning.", by: "Owen", reviewer: "Hana", daysAgo: 690, file: svg("/demo-docs/cfd-dwg-0001-b.svg", "CFD-DWG-0001 Rev B.svg", 6134) },
      { summary: "Adds PDU-A1 and PDU-B1 for Data Hall 1.", by: "Owen", reviewer: "Hana", daysAgo: 420, file: svg("/demo-docs/cfd-dwg-0001-c.svg", "CFD-DWG-0001 Rev C.svg", 7452) },
    ],
  },
  {
    type: "drawing",
    title: "Data Hall 1 row A liquid cooling schematic",
    flocs: ["CFD-DH1-CDU-01", "CFD-DH1-CDU-02"],
    revs: [{ summary: "Issued with the row A liquid cooling project.", by: "Owen", reviewer: "Hana", daysAgo: 400, file: svg("/demo-docs/cfd-dwg-0002-a.svg", "CFD-DWG-0002 Rev A.svg", 4636) }],
    uses: [{ wo: 2005, source: "plan", by: "Owen" }],
  },
  {
    type: "specification",
    title: "Secondary coolant specification, PG25",
    flocs: ["CFD-DH1-CDU-01", "CFD-DH1-CDU-02"],
    revs: [
      {
        summary: "Initial issue.",
        by: "Owen",
        reviewer: "Hana",
        daysAgo: 400,
        body: `# Secondary coolant, technology cooling system loop

| Property | Limit |
|---|---|
| Fluid | 25% propylene glycol, inhibited, premixed |
| pH | 8.0 to 10.0 |
| Conductivity | Below 3,000 µS/cm |
| Glycol concentration | 23 to 27% by refractometer |
| Particulates | Filtered to 100 µm at the CDU |
| Bacteria | Below 1,000 CFU/mL |

Sample monthly at the CDU sample port. Top up only with the same premixed fluid; never with water.`,
      },
      {
        summary: "Filtration limit to 50 µm under CFD-MOC-0001.",
        by: "Owen",
        reviewer: "Hana",
        daysAgo: 305,
        body: `# Secondary coolant, technology cooling system loop

| Property | Limit |
|---|---|
| Fluid | 25% propylene glycol, inhibited, premixed |
| pH | 8.0 to 10.0 |
| Conductivity | Below 3,000 µS/cm |
| Glycol concentration | 23 to 27% by refractometer |
| Particulates | Filtered to 50 µm at the CDU (see CFD-MOC-0001) |
| Bacteria | Below 1,000 CFU/mL |

Sample monthly at the CDU sample port. Top up only with the same premixed fluid; never with water.`,
      },
    ],
  },
  {
    type: "procedure",
    title: "CDU secondary strainer change: method of procedure",
    flocs: ["CFD-DH1-CDU-01", "CFD-DH1-CDU-02"],
    revs: [
      {
        summary: "Initial issue.",
        by: "Owen",
        reviewer: "Hana",
        daysAgo: 395,
        body: `# CDU secondary strainer change

1. Transfer row A to CDU-02.
2. Isolate CDU-01 secondary.
3. Change the 100 µm strainer basket.
4. Return to service.`,
      },
      {
        summary: "Rewritten as a full MOP for the 50 µm baskets under CFD-MOC-0001, with the transfer and verification steps.",
        by: "Owen",
        reviewer: "Hana",
        daysAgo: 300,
        body: `# CDU secondary strainer change: method of procedure

Risk: row A direct-to-chip cabinets (A03, A04) rely on the CDUs. CDU-02 is the redundant unit. References: CFD-DWG-0002, CFD-SPC-0001, CFD-MOC-0001.

## Preconditions

- Change window approved by the customer contact and the shift lead.
- CDU-02 healthy: no alarms, pumps available, supply temperature in band.
- Spare 50 µm basket and gasket at the unit.

## Steps

1. At the BMS, transfer row A to CDU-02. Confirm secondary flow and supply temperature hold for 10 minutes. **Hold point: shift lead confirms.**
2. Close the CDU-01 secondary supply and return isolation valves. Tag them.
3. Relieve pressure at the strainer drain into the catch container.
4. Remove the strainer cover and basket. Photograph the debris and log it as a finding.
5. Fit the new 50 µm basket and a new cover gasket. Torque the cover bolts to 35 ft-lb.
6. Fill and vent through the high-point vent until fluid runs clear of air.
7. Open the isolation valves. Return CDU-01 to service and hand row A back if CDU-01 is the duty unit.

## Back-out

If CDU-02 alarms during the work, stop, close the strainer cover and return CDU-01 to service.

## Verification

Strainer differential below 3 psi at full flow. No leaks after 30 minutes.`,
      },
      {
        summary: "Adds a coolant sample after refill and the glycol check from CFD-SPC-0001.",
        by: "Owen",
        daysAgo: 1,
        status: "draft",
        body: `# CDU secondary strainer change: method of procedure

Risk: row A direct-to-chip cabinets (A03, A04) rely on the CDUs. CDU-02 is the redundant unit. References: CFD-DWG-0002, CFD-SPC-0001, CFD-MOC-0001.

## Preconditions

- Change window approved by the customer contact and the shift lead.
- CDU-02 healthy: no alarms, pumps available, supply temperature in band.
- Spare 50 µm basket and gasket at the unit.

## Steps

1. At the BMS, transfer row A to CDU-02. Confirm secondary flow and supply temperature hold for 10 minutes. **Hold point: shift lead confirms.**
2. Close the CDU-01 secondary supply and return isolation valves. Tag them.
3. Relieve pressure at the strainer drain into the catch container.
4. Remove the strainer cover and basket. Photograph the debris and log it as a finding.
5. Fit the new 50 µm basket and a new cover gasket. Torque the cover bolts to 35 ft-lb.
6. Fill and vent through the high-point vent until fluid runs clear of air.
7. Take a coolant sample at the sample port; check glycol at 23 to 27% by refractometer (CFD-SPC-0001).
8. Open the isolation valves. Return CDU-01 to service and hand row A back if CDU-01 is the duty unit.

## Back-out

If CDU-02 alarms during the work, stop, close the strainer cover and return CDU-01 to service.

## Verification

Strainer differential below 3 psi at full flow. No leaks after 30 minutes. Glycol in range.`,
      },
    ],
    uses: [{ wo: 2005, source: "plan", by: "Owen", views: [{ by: "Mateo", hoursIntoWork: 0.25 }] }],
  },
  {
    type: "procedure",
    title: "Generator monthly load test",
    flocs: ["CFD-GEN-G-01", "CFD-GEN-G-02"],
    revs: [
      {
        summary: "Initial issue.",
        by: "Owen",
        reviewer: "Hana",
        daysAgo: 650,
        body: `# Generator monthly load test

1. Notify the customer contacts and the shift lead 24 hours ahead.
2. Confirm fuel above 75% at the bulk tank and day tank.
3. Start from the paralleling controls in test mode. Record time to rated voltage and frequency: 10 seconds maximum.
4. Load to at least 30% of nameplate for 30 minutes on the load bank.
5. Record oil pressure, coolant temperature, voltage, frequency and kW every 10 minutes.
6. Cool down 5 minutes unloaded, then return to auto.

Anything slower than 10 seconds to rated voltage is a discrepancy: write it up.`,
      },
    ],
    uses: [{ wo: 2008, source: "attached", by: "Owen" }],
  },
  {
    type: "procedure",
    title: "Temporary spot cooling during a CRAH outage",
    flocs: ["CFD-DH1-CRAH-01", "CFD-DH1-CRAH-02", "CFD-DH1-CRAH-03", "CFD-DH1-CRAH-04"],
    revs: [
      {
        summary: "Initial issue, for commissioning.",
        by: "Owen",
        reviewer: "Hana",
        daysAgo: 710,
        body: `# Temporary spot cooling

Used during commissioning when a CRAH was out of service before redundancy was proven.

1. Place the portable cooling units at the affected cold aisle.
2. Run condensate hoses to the floor drain.
3. Remove when the CRAH is back in service.`,
      },
    ],
    obsolete: { by: "Hana", daysAgo: 600, reason: "Retired after commissioning: N+1 CRAH redundancy was proven, so a single CRAH outage needs no temporary cooling." },
  },
  {
    type: "moc",
    title: "CDU secondary filtration from 100 µm to 50 µm",
    flocs: ["CFD-DH1-CDU-01", "CFD-DH1-CDU-02"],
    revs: [
      {
        summary: "Approved change.",
        by: "Owen",
        reviewer: "Chris",
        daysAgo: 310,
        body: `# Management of change: 50 µm CDU strainers

## Change

Replace the 100 µm secondary strainer baskets in CDU-01 and CDU-02 with 50 µm baskets.

## Why

The cold plate vendor requires 50 µm filtration on the technology cooling system loop for the new GPU cabinets in row A.

## Review

| Area | Finding |
|---|---|
| Hydraulics | Added clean pressure drop 0.8 psi; pumps have margin |
| Maintenance | Strainers will load faster; differential alarm stays at 5 psi, changes expected monthly at first |
| Spares | 50 µm baskets added to the storeroom |
| Documents | CFD-PRC-0001 to Rev B, CFD-SPC-0001 updated |

## Approval

Approved by the site admin after review by the facility engineer and the customer's cooling contact.`,
      },
    ],
  },
];
