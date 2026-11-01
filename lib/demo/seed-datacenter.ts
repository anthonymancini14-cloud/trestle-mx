/**
 * Demo dataset: a fictional owned data center.
 *
 * "Cedar Flats Data Center" is invented, like every person, asset, reading
 * and work order here. It belongs to the same fictional organization as
 * Basalt Ridge Plant, so both sites share one asset class library and one
 * storeroom catalog. Power is 2N (A and B sides), cooling is a chilled water
 * plant with CRAHs plus liquid cooling (CDUs) for the high-density row, and
 * the cable plant is recorded: labeled tray sections, installed cables, and
 * each cable's route through the trays.
 */
import { seedId } from "./ids";
import { classId, ORG, type AssetDef, type WoDef } from "./seed";
import type { AreaCode, Asset, CableSpec, InventoryRow, Part, Profile, Site } from "@/types/domain";

export const DC_SITE: Site = {
  id: seedId("site", 2),
  org_id: ORG.id,
  code: "CFD",
  name: "Cedar Flats Data Center",
  timezone: "America/Denver",
  vertical: "data_center",
};

const AREA_DEFS: [string, string][] = [
  ["MVS", "Medium-Voltage Substation"],
  ["ELA", "Electrical Room A"],
  ["ELB", "Electrical Room B"],
  ["GEN", "Generator Yard"],
  ["CUP", "Central Utility Plant"],
  ["DH1", "Data Hall 1"],
  ["MMR", "Meet-Me Room"],
];

export const DC_AREAS: AreaCode[] = AREA_DEFS.map(([code, name], i) => ({
  id: seedId("area", 101 + i),
  site_id: DC_SITE.id,
  code,
  name,
}));

export const DC_PROFILES: Profile[] = [
  { id: seedId("profile", 101), full_name: "Owen Castillo", role: "planner", craft: null, is_active: true },
  { id: seedId("profile", 102), full_name: "Hana Brooks", role: "supervisor", craft: null, is_active: true },
  { id: seedId("profile", 103), full_name: "Leo Marsh", role: "gatekeeper", craft: null, is_active: true },
  { id: seedId("profile", 104), full_name: "Tasha Greene", role: "technician", craft: "electrical", is_active: true },
  { id: seedId("profile", 105), full_name: "Mateo Ruiz", role: "technician", craft: "mechanical", is_active: true },
  { id: seedId("profile", 106), full_name: "Kai Nakamura", role: "technician", craft: "instrumentation", is_active: true },
  { id: seedId("profile", 107), full_name: "Rafael Ortiz", role: "technician", craft: "contractor", is_active: true },
  { id: seedId("profile", 108), full_name: "Dana Price", role: "storeroom", craft: null, is_active: true },
];

// FLOCs: CFD-<area>-<tag>. Cables use CBL-nnnn; tray sections CT-x. Labels on
// both ends of every cable and tray section match these tags.
const TRAY_A = "CFD-DH1-CT-A";
const TRAY_B = "CFD-DH1-CT-B";
const TRAY_X = "CFD-DH1-CT-X1";
const TRAY_MMR = "CFD-MMR-CT-01";
const TRAY_PA = "CFD-DH1-CT-PA";
const TRAY_PB = "CFD-DH1-CT-PB";

const ups = (side: "A" | "B", n: number): AssetDef => ({
  floc: `CFD-EL${side}-UPS-${side}${n}`,
  name: `UPS module ${side}${n}`,
  cls: "UPS-STATIC",
  attrs: { rating: 1000, redundancy: "2N", energy_storage: "Li-ion", firmware: "4.12" },
  crit: "A",
  mfr: "Generic",
  model: "DC-UPS-1000",
  installYear: 2024,
  notes: `${side}-side UPS. With 2N power, taking one ${side}-side module out leaves the ${side} side at N: plan it under a MOP and a change window.`,
});
const battery = (side: "A" | "B", n: number): AssetDef => ({
  floc: `CFD-EL${side}-BAT-${side}${n}`,
  name: `Battery string ${side}${n}`,
  cls: "BATT-STRING",
  attrs: { chemistry: "Li-ion", jars: 16, capacity: 160, monitored: true },
  crit: "A",
  mfr: "Generic",
  model: "LI-160",
  parent: `CFD-EL${side}-UPS-${side}${n}`,
  installYear: 2024,
});
const crah = (n: number, attrs: AssetDef["attrs"]): AssetDef => ({
  floc: `CFD-DH1-CRAH-0${n}`,
  name: `Computer room air handler ${n}`,
  cls: "CRAH",
  attrs,
  crit: "B",
  mfr: "Generic",
  model: "CW-150",
  installYear: 2024,
});
const cabinet = (id: string, attrs: AssetDef["attrs"], notes?: string): AssetDef => ({
  floc: `CFD-DH1-CAB-${id}`,
  name: `Cabinet ${id}`,
  cls: "CABINET",
  attrs,
  crit: "B",
  mfr: "Generic",
  model: "48U-800",
  installYear: 2024,
  notes,
});

const DC_ASSET_DEFS: AssetDef[] = [
  // Medium voltage
  { floc: "CFD-MVS-XFMR-01", name: "Utility service transformer 1", cls: "XFMR-LIQ", attrs: { rating: 5000, primary_voltage: 34.5, secondary_voltage: 480, cooling_class: "ONAN/ONAF", fluid: "Natural ester" }, crit: "A", mfr: "Generic", model: "5 MVA pad-mount", installYear: 2023 },
  { floc: "CFD-MVS-SWGR-01", name: "Medium-voltage switchgear", cls: "SWGR", attrs: { voltage_class: "MV", bus_rating: 1200, breaker_type: "Vacuum", arc_resistant: true }, crit: "A", mfr: "Generic", model: "MV-15", installYear: 2023 },
  // A side
  { floc: "CFD-ELA-SWGR-A", name: "Low-voltage switchgear A", cls: "SWGR", attrs: { voltage_class: "LV", bus_rating: 4000, breaker_type: "Air", arc_resistant: true }, crit: "A", mfr: "Generic", model: "LV-4000", installYear: 2024 },
  ups("A", 1),
  ups("A", 2),
  battery("A", 1),
  battery("A", 2),
  { floc: "CFD-ELA-EPMS-01", name: "Electrical power monitoring controller", cls: "BMS-CTRL", attrs: { system: "EPMS", protocol: "Modbus", firmware: "2.8.1" }, crit: "B", mfr: "Generic", model: "EPMS-GW", installYear: 2024 },
  // B side
  { floc: "CFD-ELB-SWGR-B", name: "Low-voltage switchgear B", cls: "SWGR", attrs: { voltage_class: "LV", bus_rating: 4000, breaker_type: "Air", arc_resistant: true }, crit: "A", mfr: "Generic", model: "LV-4000", installYear: 2024 },
  ups("B", 1),
  ups("B", 2),
  battery("B", 1),
  battery("B", 2),
  // Generator yard
  { floc: "CFD-GEN-G-01", name: "Generator 1", cls: "GEN-DIESEL", attrs: { rating: 2500, voltage: 480, fuel_capacity: 3000, epss_level: "Level 2" }, crit: "A", mfr: "Generic", model: "2500 kW", installYear: 2024, status: "standby" },
  { floc: "CFD-GEN-G-02", name: "Generator 2", cls: "GEN-DIESEL", attrs: { rating: 2500, voltage: 480, fuel_capacity: 3000, epss_level: "Level 2" }, crit: "A", mfr: "Generic", model: "2500 kW", installYear: 2024, status: "standby" },
  { floc: "CFD-GEN-ATS-01", name: "House loads transfer switch", cls: "ATS", attrs: { rating: 800, voltage: 480, transition: "Open" }, crit: "B", mfr: "Generic", model: "ATS-800", installYear: 2024 },
  { floc: "CFD-GEN-TK-01", name: "Bulk diesel storage tank", cls: "TANK", attrs: { capacity: 20000, material: "Double-wall steel", contents: "Ultra-low sulfur diesel", secondary_containment: true }, crit: "A", mfr: "Generic", model: "UL 142 20,000 gal", installYear: 2024 },
  // Central utility plant
  { floc: "CFD-CUP-CH-01", name: "Chiller 1", cls: "CHILLER", attrs: { capacity: 1000, compressor: "Magnetic bearing centrifugal", refrigerant: "R-1233zd(E)" }, crit: "A", mfr: "Generic", model: "MBC-1000", installYear: 2024 },
  { floc: "CFD-CUP-CH-02", name: "Chiller 2", cls: "CHILLER", attrs: { capacity: 1000, compressor: "Magnetic bearing centrifugal", refrigerant: "R-1233zd(E)" }, crit: "A", mfr: "Generic", model: "MBC-1000", installYear: 2024 },
  { floc: "CFD-CUP-P-01A", name: "Chilled water pump A", cls: "PUMP-CENT", attrs: { configuration: "Horizontal split case", rated_flow: 2400, rated_head: 120, speed: 1780, seal_type: "Single mechanical" }, crit: "A", mfr: "Generic", model: "HSC 8x10-14", installYear: 2024 },
  { floc: "CFD-CUP-P-01B", name: "Chilled water pump B", cls: "PUMP-CENT", attrs: { configuration: "Horizontal split case", rated_flow: 2400, rated_head: 120, speed: 1780, seal_type: "Single mechanical" }, crit: "A", mfr: "Generic", model: "HSC 8x10-14", installYear: 2024, status: "standby" },
  { floc: "CFD-CUP-CT-01", name: "Cooling tower 1 fan and gearbox", cls: "FAN-CT", attrs: { diameter: 14, gear_ratio: "9.5:1", motor_power: 60, blade_material: "FRP" }, crit: "B", mfr: "Generic", model: "CT-FAN-14", installYear: 2024 },
  { floc: "CFD-CUP-BMS-01", name: "Building management system controller", cls: "BMS-CTRL", attrs: { system: "BMS", protocol: "BACnet", firmware: "6.2" }, crit: "B", mfr: "Generic", model: "BMS-NC", installYear: 2024 },
  // Data Hall 1: cooling and fire protection
  crah(1, { capacity: 150, fan_type: "EC plug", cooling_medium: "Chilled water" }),
  crah(2, { capacity: 150, fan_type: "EC plug", cooling_medium: "Chilled water" }),
  crah(3, { capacity: 150, fan_type: "EC plug", cooling_medium: "Chilled water" }),
  crah(4, { capacity: 150, cooling_medium: "Chilled water" }),
  { floc: "CFD-DH1-CDU-01", name: "Coolant distribution unit 1, row A", cls: "CDU", attrs: { capacity: 1000, secondary_fluid: "PG25", pump_redundancy: "N+1", filtration: 50 }, crit: "A", mfr: "Generic", model: "CDU-1000", installYear: 2025, notes: "Serves the direct-to-chip cooled cabinets in row A (A03, A04)." },
  { floc: "CFD-DH1-CDU-02", name: "Coolant distribution unit 2, row A", cls: "CDU", attrs: { capacity: 1000, secondary_fluid: "PG25", pump_redundancy: "N+1", filtration: 50 }, crit: "A", mfr: "Generic", model: "CDU-1000", installYear: 2025, status: "standby", notes: "Redundant CDU for row A." },
  { floc: "CFD-DH1-FS-01", name: "Data Hall 1 pre-action sprinkler system", cls: "FIRE-SUPP", attrs: { system_type: "Pre-action sprinkler", agent: "Water, double interlock", protected_area: "Data Hall 1" }, crit: "A", mfr: "Generic", model: "PA-DI", installYear: 2024 },
  // Data Hall 1: power distribution (2N)
  { floc: "CFD-DH1-PDU-A1", name: "Power distribution unit A1 (A side)", cls: "PDU", attrs: { rating: 300, input_voltage: 480, output_voltage: 208, branch_monitoring: true }, crit: "A", mfr: "Generic", model: "PDU-300", installYear: 2024 },
  { floc: "CFD-DH1-PDU-B1", name: "Power distribution unit B1 (B side)", cls: "PDU", attrs: { rating: 300, input_voltage: 480, output_voltage: 208, branch_monitoring: true }, crit: "A", mfr: "Generic", model: "PDU-300", installYear: 2024 },
  // Cabinets
  cabinet("A01", { rack_units: 48, design_load: 15, cooling: "Air", power_feeds: "A and B" }),
  cabinet("A02", { rack_units: 48, design_load: 15, cooling: "Air", power_feeds: "A and B" }),
  cabinet("A03", { rack_units: 48, design_load: 80, cooling: "Direct-to-chip liquid", power_feeds: "A and B" }, "GPU cabinet on CDU-01. Fiber via trunk CFD-DH1-CBL-0101."),
  cabinet("A04", { rack_units: 48, design_load: 80, cooling: "Direct-to-chip liquid", power_feeds: "A and B" }, "GPU cabinet on CDU-01. Fiber via trunk CFD-DH1-CBL-0102."),
  cabinet("B01", { rack_units: 48, design_load: 15, cooling: "Air", power_feeds: "A and B" }),
  cabinet("B02", { rack_units: 48, design_load: 15, cooling: "Air", power_feeds: "A and B" }),
  { floc: "CFD-MMR-ODF-01", name: "Optical distribution frame 1", cls: "CABINET", attrs: { rack_units: 45, design_load: 2, cooling: "Air", power_feeds: "A only" }, crit: "A", mfr: "Generic", model: "ODF-45", installYear: 2024, notes: "Fiber backbone to Data Hall 1 lands here: panel 2 serves row A, panel 3 serves row B." },
  // Cable pathways: one asset per labeled tray section
  { floc: TRAY_MMR, name: "MMR backbone ladder rack to Data Hall 1", cls: "CABLE-TRAY", attrs: { tray_type: "Cable ladder rack", service: "Fiber", width: 24, depth: 6, location: "Meet-Me Room to the Data Hall 1 north wall penetration, upper tier at 10 ft", design_fill: 25 }, crit: "B", installYear: 2024 },
  { floc: TRAY_X, name: "Cross-aisle ladder rack, rows A and B", cls: "CABLE-TRAY", attrs: { tray_type: "Cable ladder rack", service: "Fiber and copper data", width: 18, depth: 6, location: "Data Hall 1 north cross aisle, upper tier at 10 ft", design_fill: 25 }, crit: "B", installYear: 2024 },
  { floc: TRAY_A, name: "Row A data basket tray", cls: "CABLE-TRAY", attrs: { tray_type: "Wire mesh basket tray", service: "Fiber and copper data", width: 12, depth: 4, location: "Above row A cabinets A01 to A04, upper tier at 9 ft, waterfall drop-outs at each cabinet", design_fill: 25 }, crit: "B", installYear: 2024 },
  { floc: TRAY_B, name: "Row B data basket tray", cls: "CABLE-TRAY", attrs: { tray_type: "Wire mesh basket tray", service: "Fiber and copper data", width: 12, depth: 4, location: "Above row B cabinets B01 and B02, upper tier at 9 ft" }, crit: "B", installYear: 2024 },
  { floc: TRAY_PA, name: "Row A power ladder rack, A feed", cls: "CABLE-TRAY", attrs: { tray_type: "Cable ladder rack", service: "Power", width: 12, depth: 4, location: "Above row A, lower tier at 8 ft, 12 in below the data tier; A feeds only", design_fill: 40 }, crit: "B", installYear: 2024 },
  { floc: TRAY_PB, name: "Row A power ladder rack, B feed", cls: "CABLE-TRAY", attrs: { tray_type: "Cable ladder rack", service: "Power", width: 12, depth: 4, location: "Above row A, lower tier at 8 ft, hot-aisle side; B feeds only", design_fill: 40 }, crit: "B", installYear: 2024 },
  // Installed cables
  { floc: "CFD-DH1-CBL-0101", name: "Fiber trunk, ODF-01 to cabinet A03 (MPO-24, OS2)", cls: "CABLE", attrs: { part_number: "MX-FIB-MPO24-OS2-45M", media: "Fiber", end_a: "CFD-MMR-ODF-01, panel 2, MPO port 1", end_b: "CFD-DH1-CAB-A03, U47 fiber cassette, MPO port 1", installed_length: 41 }, crit: "A", mfr: "Generic", installYear: 2024, notes: "Carries 12 duplex 400G links to the A03 GPU cabinet." },
  { floc: "CFD-DH1-CBL-0102", name: "Fiber trunk, ODF-01 to cabinet A04 (MPO-24, OS2)", cls: "CABLE", attrs: { part_number: "MX-FIB-MPO24-OS2-45M", media: "Fiber", end_a: "CFD-MMR-ODF-01, panel 2, MPO port 2", end_b: "CFD-DH1-CAB-A04, U47 fiber cassette, MPO port 1", installed_length: 43 }, crit: "A", mfr: "Generic", installYear: 2024 },
  { floc: "CFD-DH1-CBL-0103", name: "Fiber trunk, ODF-01 to cabinet B02 (MPO-24, OS2)", cls: "CABLE", attrs: { part_number: "MX-FIB-MPO24-OS2-30M", media: "Fiber", end_a: "CFD-MMR-ODF-01, panel 3, MPO port 1", end_b: "CFD-DH1-CAB-B02, U47 fiber cassette, MPO port 1", installed_length: 29 }, crit: "B", mfr: "Generic", installYear: 2024 },
  { floc: "CFD-DH1-CBL-0201", name: "Copper management link, A01 to A04 (Cat6A)", cls: "CABLE", attrs: { part_number: "MX-CU-C6A-BULK", media: "Copper data", end_a: "CFD-DH1-CAB-A01, U46 patch panel, port 4", end_b: "CFD-DH1-CAB-A04, U46 patch panel, port 1" }, crit: "C", mfr: "Generic", installYear: 2024 },
  { floc: "CFD-DH1-CBL-0301", name: "Power whip, PDU-A1 to cabinet A03 (A feed)", cls: "CABLE", attrs: { part_number: "MX-PWR-WHIP-L2130-15M", media: "Power", end_a: "CFD-DH1-PDU-A1, panel 1, breaker 13-15-17", end_b: "CFD-DH1-CAB-A03, rack PDU A inlet (L21-30P)", installed_length: 14 }, crit: "A", mfr: "Generic", installYear: 2024 },
  { floc: "CFD-DH1-CBL-0302", name: "Power whip, PDU-B1 to cabinet A03 (B feed)", cls: "CABLE", attrs: { part_number: "MX-PWR-WHIP-L2130-15M", media: "Power", end_a: "CFD-DH1-PDU-B1, panel 1, breaker 13-15-17", end_b: "CFD-DH1-CAB-A03, rack PDU B inlet (L21-30P)", installed_length: 15 }, crit: "A", mfr: "Generic", installYear: 2024 },
];

const areaId = (code: string) => {
  const area = DC_AREAS.find((a) => a.code === code);
  if (!area) throw new Error(`Unknown area ${code}`);
  return area.id;
};

export const DC_ASSETS: Asset[] = DC_ASSET_DEFS.map((d, i) => ({
  id: seedId("asset", 101 + i),
  site_id: DC_SITE.id,
  area_id: areaId(d.floc.split("-")[1]),
  parent_id: null,
  floc: d.floc,
  name: d.name,
  class_id: classId(d.cls),
  attributes: { ...d.attrs },
  criticality: d.crit,
  manufacturer: d.mfr ?? null,
  model: d.model ?? null,
  serial_number: d.cls === "CABLE-TRAY" || d.cls === "CABLE" ? null : `SN-${(73100 + i * 41).toString()}`,
  install_date: d.installYear ? `${d.installYear}-03-01` : null,
  status: d.status ?? "running",
  notes: d.notes ?? null,
}));
DC_ASSET_DEFS.forEach((d, i) => {
  if (d.parent) {
    const parent = DC_ASSETS.find((a) => a.floc === d.parent);
    if (!parent) throw new Error(`Unknown parent ${d.parent}`);
    DC_ASSETS[i].parent_id = parent.id;
  }
});

/** Each cable's route, end A to end B, through tray sections. */
export const DC_CABLE_ROUTES: { cable: string; route: { tray: string; note?: string }[] }[] = [
  {
    cable: "CFD-DH1-CBL-0101",
    route: [
      { tray: TRAY_MMR, note: "Leaves ODF-01 top, runs the backbone to the north wall penetration" },
      { tray: TRAY_X, note: "Turns south at the row A junction" },
      { tray: TRAY_A, note: "Drops into A03 at the waterfall over the cabinet's rear half" },
    ],
  },
  {
    cable: "CFD-DH1-CBL-0102",
    route: [{ tray: TRAY_MMR }, { tray: TRAY_X }, { tray: TRAY_A, note: "Drops into A04 at its waterfall" }],
  },
  {
    cable: "CFD-DH1-CBL-0103",
    route: [{ tray: TRAY_MMR }, { tray: TRAY_X, note: "Continues past row A to the row B junction" }, { tray: TRAY_B, note: "Drops into B02" }],
  },
  { cable: "CFD-DH1-CBL-0201", route: [{ tray: TRAY_A, note: "Runs the length of row A, A01 to A04" }] },
  { cable: "CFD-DH1-CBL-0301", route: [{ tray: TRAY_PA, note: "PDU-A1 end of the row to A03" }] },
  { cable: "CFD-DH1-CBL-0302", route: [{ tray: TRAY_PB, note: "PDU-B1 end of the row to A03" }] },
];

// ------------------------------------------------------------------ storeroom

const cable = (spec: Omit<CableSpec, "kind">): CableSpec => ({ kind: "cable", ...spec });

interface DcPartDef {
  pn: string;
  desc: string;
  cat: string;
  cost: number;
  unit?: string;
  bin: string;
  onHand: number;
  min: number;
  max: number;
  specs?: CableSpec;
}

const DC_PART_DEFS: DcPartDef[] = [
  {
    pn: "MX-FIB-MPO24-OS2-45M",
    desc: "Fiber trunk, MPO-24 female to MPO-24 female, OS2 single-mode, 45 m, plenum, Type B",
    cat: "Cable",
    cost: 412,
    bin: "K-01-01",
    onHand: 1,
    min: 1,
    max: 2,
    specs: cable({ media: "Fiber", cable_type: "OS2 single-mode trunk", count: 24, gauge: "OS2 9/125 µm", length_m: 45, outer_diameter_mm: 4.5, jacket: "OFNP plenum", termination_a: "MPO-24 female, APC", termination_b: "MPO-24 female, APC", polarity: "Type B", color: "Yellow" }),
  },
  {
    pn: "MX-FIB-MPO24-OS2-30M",
    desc: "Fiber trunk, MPO-24 female to MPO-24 female, OS2 single-mode, 30 m, plenum, Type B",
    cat: "Cable",
    cost: 344,
    bin: "K-01-02",
    onHand: 2,
    min: 1,
    max: 2,
    specs: cable({ media: "Fiber", cable_type: "OS2 single-mode trunk", count: 24, gauge: "OS2 9/125 µm", length_m: 30, outer_diameter_mm: 4.5, jacket: "OFNP plenum", termination_a: "MPO-24 female, APC", termination_b: "MPO-24 female, APC", polarity: "Type B", color: "Yellow" }),
  },
  {
    pn: "MX-FIB-LC-OS2-3M",
    desc: "Fiber jumper, LC duplex to LC duplex, OS2 single-mode, 3 m",
    cat: "Cable",
    cost: 18,
    bin: "K-02-01",
    onHand: 24,
    min: 12,
    max: 48,
    specs: cable({ media: "Fiber", cable_type: "OS2 single-mode duplex jumper", count: 2, gauge: "OS2 9/125 µm", length_m: 3, outer_diameter_mm: 2, jacket: "OFNR riser", termination_a: "LC/UPC duplex", termination_b: "LC/UPC duplex", polarity: "A-to-B", color: "Yellow" }),
  },
  {
    pn: "MX-CU-C6A-PC-3M",
    desc: "Patch cord, Cat6A S/FTP, RJ45 to RJ45, 3 m, blue",
    cat: "Cable",
    cost: 14,
    bin: "K-03-01",
    onHand: 40,
    min: 20,
    max: 80,
    specs: cable({ media: "Copper data", cable_type: "Cat6A S/FTP patch cord", count: 8, gauge: "26 AWG stranded", length_m: 3, outer_diameter_mm: 6, jacket: "LSZH", termination_a: "RJ45, shielded", termination_b: "RJ45, shielded", color: "Blue" }),
  },
  {
    pn: "MX-CU-C6A-BULK",
    desc: "Cat6A U/FTP horizontal cable, 23 AWG solid, plenum, 305 m box",
    cat: "Cable",
    cost: 690,
    unit: "box",
    bin: "K-03-05",
    onHand: 2,
    min: 1,
    max: 3,
    specs: cable({ media: "Copper data", cable_type: "Cat6A U/FTP horizontal", count: 8, gauge: "23 AWG solid", length_m: null, outer_diameter_mm: 7.2, jacket: "CMP plenum", termination_a: "Unterminated (field-terminate to RJ45 jack)", termination_b: "Unterminated (field-terminate to RJ45 jack)", color: "Blue" }),
  },
  {
    pn: "MX-PWR-WHIP-L2130-15M",
    desc: "Power whip, 208 V 3-phase, 10 AWG 5-wire in flexible metal conduit, L21-30R, 15 m",
    cat: "Cable",
    cost: 486,
    bin: "K-04-01",
    onHand: 2,
    min: 2,
    max: 4,
    specs: cable({ media: "Power", cable_type: "208 V 3-phase power whip", count: 5, gauge: "10 AWG", length_m: 15, outer_diameter_mm: 22, jacket: "Flexible metal conduit", termination_a: "Lugs to PDU branch breaker", termination_b: "NEMA L21-30R receptacle", color: "Gray (A feed label red)" }),
  },
  {
    pn: "MX-PWR-C19C20-2M",
    desc: "Power cord, IEC C20 to C19, 12 AWG, 2 m",
    cat: "Cable",
    cost: 16,
    bin: "K-04-05",
    onHand: 30,
    min: 20,
    max: 60,
    specs: cable({ media: "Power", cable_type: "IEC power cord", count: 3, gauge: "12 AWG", length_m: 2, outer_diameter_mm: 9.5, jacket: "SJT", termination_a: "IEC 60320 C20 plug", termination_b: "IEC 60320 C19 connector", color: "Black" }),
  },
  { pn: "MX-FIB-CASS-MPO24", desc: "Fiber cassette, MPO-24 to 12 LC duplex, OS2, Type B", cat: "Fiber connectivity", cost: 238, bin: "K-02-05", onHand: 3, min: 2, max: 4 },
  { pn: "MX-TRAY-WFALL-12", desc: "Wire mesh basket tray waterfall drop-out, 12 in", cat: "Pathway hardware", cost: 34, bin: "K-06-01", onHand: 4, min: 4, max: 8 },
  { pn: "MX-TRAY-BOND-KIT", desc: "Cable tray bonding jumper kit, 6 AWG", cat: "Pathway hardware", cost: 22, bin: "K-06-03", onHand: 6, min: 4, max: 10 },
  { pn: "MX-LBL-CABLE-606", desc: "Self-laminating cable labels, printable, roll of 250", cat: "Consumables", cost: 38, unit: "roll", bin: "K-07-01", onHand: 3, min: 2, max: 6 },
  { pn: "MX-UPS-FAN-1000", desc: "UPS power module cooling fan kit, DC-UPS-1000", cat: "Electrical", cost: 640, bin: "F-11-01", onHand: 2, min: 2, max: 4 },
  { pn: "MX-FLT-CRAH-M8", desc: "CRAH filter set, MERV 8, CW-150", cat: "Filters", cost: 186, unit: "set", bin: "C-11-01", onHand: 6, min: 4, max: 12 },
  { pn: "MX-FAN-CRAH-EC", desc: "EC fan module, CW-150", cat: "HVAC", cost: 1420, bin: "C-12-01", onHand: 1, min: 1, max: 2 },
  { pn: "MX-CDU-STRN-50", desc: "CDU secondary strainer element, 50 micron", cat: "Filters", cost: 96, bin: "C-13-01", onHand: 3, min: 2, max: 6 },
  { pn: "MX-CDU-PG25-5G", desc: "Propylene glycol coolant, 25% premix with inhibitor, 5 gal", cat: "Consumables", cost: 118, unit: "pail", bin: "C-13-04", onHand: 8, min: 4, max: 12 },
  { pn: "MX-GEN-FLT-2500", desc: "Generator filter service kit (oil, fuel, air), 2500 kW", cat: "Filters", cost: 612, unit: "kit", bin: "G-01-01", onHand: 1, min: 2, max: 4 },
];

export const DC_PARTS: Part[] = DC_PART_DEFS.map((d, i) => ({
  id: seedId("part", 101 + i),
  org_id: ORG.id,
  part_number: d.pn,
  description: d.desc,
  manufacturer: null,
  mfr_part_number: null,
  category: d.cat,
  unit: d.unit ?? "ea",
  unit_cost: d.cost,
  specs: d.specs ?? null,
}));

export const DC_INVENTORY: InventoryRow[] = DC_PART_DEFS.map((d, i) => ({
  id: seedId("inventory", 101 + i),
  site_id: DC_SITE.id,
  part_id: DC_PARTS[i].id,
  bin: d.bin,
  on_hand: d.onHand,
  reserved: 0,
  min_qty: d.min,
  max_qty: d.max,
}));

// --------------------------------------------------------------- work orders

export const DC_CREW = { gatekeeper: "Leo", planner: "Owen", supervisor: "Hana", technician: "Tasha" };

export const DC_WO_DEFS: WoDef[] = [
  // ---------------- Closed history ----------------
  {
    num: 2001,
    title: "Row A basket tray: add waterfall drop-outs at A03 and A04",
    description: "New GPU cabinets A03 and A04 need radius-controlled drop-outs from the row A data tray before fiber trunks are dressed in.",
    floc: TRAY_A, type: "project", priority: 3, stage: "closure", status: "closed",
    reportedBy: "Owen", assignedTo: "Rafael", createdDaysAgo: 140, estHours: 4, actualHours: 6,
    planSummary: "Install 12 in waterfall drop-outs over A03 and A04, bond them to the tray, re-dress trunks onto the radius.",
    debrief: "Installed both waterfalls and bonded them. A04 trunk re-dressed onto its waterfall. At A03 the trunk CFD-DH1-CBL-0101 was already carrying live links and sat on the tray edge with a tight bend at the drop; could not re-dress without an outage, so left it as found and labeled the spot. Recommend re-dressing or replacing CBL-0101 in the next change window. Took 6 h, not 4: working from the lift around the live trunk.",
    tasks: [
      { desc: "Set up lift in the hot aisle, confirm no work over energized power tray", craft: "contractor", hours: 0.5, done: true },
      { desc: "Install waterfall drop-outs over A03 and A04; bond to tray", craft: "contractor", crew: 2, hours: 2, done: true },
      { desc: "Re-dress fiber trunks onto the waterfalls; label", craft: "contractor", crew: 2, hours: 1, done: true },
    ],
    parts: [
      { pn: "MX-TRAY-WFALL-12", qty: 2, used: 2, status: "issued" },
      { pn: "MX-TRAY-BOND-KIT", qty: 2, used: 2, status: "issued" },
    ],
  },
  {
    num: 2002,
    title: "UPS-A1 annual preventive maintenance (OEM)",
    description: "Annual OEM preventive maintenance on UPS module A1 under MOP; A side at N for the duration.",
    floc: "CFD-ELA-UPS-A1", type: "preventive", priority: 3, stage: "closure", status: "closed",
    reportedBy: "Owen", assignedTo: "Tasha", createdDaysAgo: 75, estHours: 6, actualHours: 7,
    planSummary: "Transfer A1 to maintenance bypass under MOP, OEM inspection, replace fans on worn power modules, return to normal.",
    debrief: "Completed under MOP; A side at N for 5 h, B side untouched. Replaced fans on two power modules (bearing noise). Thermal scan clean. Took 7 h against 6 because the OEM engineer arrived late; build an arrival buffer into the MOP next time.",
    parts: [{ pn: "MX-UPS-FAN-1000", qty: 2, used: 2, status: "issued" }],
  },
  {
    num: 2003,
    title: "CRAH-02 fan module failure",
    description: "CRAH-02 alarmed on fan 3 failure; unit running at reduced airflow.",
    floc: "CFD-DH1-CRAH-02", type: "corrective", priority: 2, stage: "closure", status: "closed",
    reportedBy: "Kai", assignedTo: "Mateo", createdDaysAgo: 40, estHours: 3, actualHours: 2.5,
    debrief: "EC fan module 3 failed on bearing. Replaced from stock and verified airflow. The other fans are at 41,000 run hours; recommend a fan replacement program by run hours.",
    parts: [{ pn: "MX-FAN-CRAH-EC", qty: 1, used: 1, status: "issued" }],
  },
  // ---------------- Closure ----------------
  {
    num: 2004,
    title: "Chiller CH-02 condenser tube cleaning",
    description: "Approach temperature on CH-02 condenser rising; scheduled tube brushing with the chiller off line and CH-01 carrying load.",
    floc: "CFD-CUP-CH-02", type: "preventive", priority: 3, stage: "closure",
    reportedBy: "Owen", assignedTo: "Mateo", createdDaysAgo: 15, estHours: 10, actualHours: 9,
  },
  // ---------------- Execution ----------------
  {
    num: 2005,
    title: "CDU-01 secondary strainer differential pressure high",
    description: "Strainer DP on CDU-01 at 9 psi against a 6 psi alarm; secondary flow to row A trending down. CDU-02 available to carry row A.",
    floc: "CFD-DH1-CDU-01", type: "corrective", priority: 2, stage: "execution",
    reportedBy: "Kai", assignedTo: "Mateo", createdDaysAgo: 3, scheduledInDays: 0, estHours: 2,
    tasks: [
      { desc: "Confirm CDU-02 carrying row A at full flow before isolating CDU-01", craft: "mechanical", hours: 0.5, accept: "Row A supply temperature and flow within limits on CDU-02 alone." },
      { desc: "Isolate CDU-01 secondary, drain strainer housing, replace element", craft: "mechanical", hours: 1, safety: "Glycol spill kit at the unit." },
      { desc: "Refill, vent, return CDU-01 to standby; record strainer DP", craft: "mechanical", hours: 0.5, accept: "Strainer DP under 3 psi at design flow." },
    ],
    parts: [
      { pn: "MX-CDU-STRN-50", qty: 1, status: "kitted" },
      { pn: "MX-CDU-PG25-5G", qty: 1, status: "kitted" },
    ],
  },
  // ---------------- Scheduling ----------------
  {
    num: 2006,
    title: "Battery string B1 quarterly inspection and ohmic test",
    description: "Quarterly inspection of battery string B1: module voltages, internal resistance trend, connections and BMS alarms.",
    floc: "CFD-ELB-BAT-B1", type: "preventive", priority: 3, stage: "scheduling",
    reportedBy: "Owen", createdDaysAgo: 6, estHours: 2,
    planSummary: "Visual and thermal inspection, module voltage and resistance readings against baseline, torque check on accessible connections.",
    tasks: [
      { desc: "Review battery management system alarms and trends", craft: "electrical", hours: 0.5 },
      { desc: "Thermal scan and visual inspection of modules and connections", craft: "electrical", hours: 0.5 },
      { desc: "Record module voltages and internal resistance; compare with baseline", craft: "electrical", hours: 1, accept: "No module more than 20% above its baseline resistance." },
    ],
  },
  // ---------------- Planning ----------------
  {
    num: 2007,
    title: "Fiber trunk CBL-0101 high loss on links to cabinet A03",
    description:
      "Network team reports rising errors on four of the 400G links that run over trunk CFD-DH1-CBL-0101 (ODF-01 panel 2 to cabinet A03). OTDR from the MMR end shows a 0.9 dB bend event at about 38 m, where the trunk drops into A03. Traffic on the affected links has been moved to spare capacity; the other links on the trunk still carry production.",
    floc: "CFD-DH1-CBL-0101", type: "corrective", priority: 2, stage: "planning", shutdown: true,
    reportedBy: "Leo", createdDaysAgo: 2,
  },
  // ---------------- Vetting ----------------
  {
    num: 2008,
    title: "Generator 2 slow to reach rated voltage on monthly test",
    description: "G-02 took 14 s to reach rated voltage and frequency on the monthly no-load start; G-01 took 9 s.",
    floc: "CFD-GEN-G-02", type: "corrective", priority: 2, stage: "vetting",
    reportedBy: "Tasha", createdDaysAgo: 1,
  },
  // ---------------- Identification ----------------
  {
    num: 2009,
    title: "CRAH-03 supply air temperature alarm",
    description: "CRAH-03 supply air 3 °F above setpoint for 40 minutes; chilled water valve at 100%.",
    floc: "CFD-DH1-CRAH-03", type: "corrective", priority: 2, stage: "identification",
    reportedBy: "Kai", createdDaysAgo: 0,
  },
  {
    num: 2010,
    title: "Row B tray section label missing at B02 drop",
    description: "Section label for the row B basket tray is missing over B02.",
    floc: TRAY_B, type: "corrective", priority: 4, stage: "identification",
    reportedBy: "Rafael", createdDaysAgo: 1,
  },
];
