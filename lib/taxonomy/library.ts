/**
 * The Trestle.MX starter asset class library.
 *
 * One controlled list of equipment classes for every site in an organization,
 * so a pump at one site and a pump at another are counted, compared and
 * maintained the same way. Each class defines:
 *
 *   - the nameplate attributes an asset of that class must carry, and
 *   - the failure modes the class is known for (ISO 14224 style codes), which
 *     PM tasks and troubleshooting records point back to.
 *
 * Classes are broad on purpose (one "Centrifugal pump" class, with the
 * configuration as an attribute) so fleet comparisons have enough members per
 * class to mean something. An organization starts from this library and can
 * add classes; local sites cannot invent their own.
 *
 * This file is product reference content, not plant data. It is the single
 * source for the demo store and for `pnpm seed:live`.
 */
import type { AttributeSpec, ClassCategory, Vertical } from "@/types/domain";

export interface FailureModeDef {
  code: string;
  name: string;
  description: string;
  detection: string;
}

export interface AssetClassDef {
  code: string;
  name: string;
  category: ClassCategory;
  verticals: Vertical[];
  description: string;
  attributes: AttributeSpec[];
  failureModes: FailureModeDef[];
}

// Attribute builders keep the definitions below readable.
const num = (key: string, label: string, unit: string, required = true): AttributeSpec => ({
  key,
  label,
  type: "number",
  unit,
  required,
});
const pick = (key: string, label: string, options: readonly string[], required = true): AttributeSpec => ({
  key,
  label,
  type: "enum",
  options,
  required,
});
const text = (key: string, label: string, required = true): AttributeSpec => ({ key, label, type: "text", required });
const flag = (key: string, label: string, required = true): AttributeSpec => ({ key, label, type: "boolean", required });

const fm = (code: string, name: string, description: string, detection: string): FailureModeDef => ({
  code,
  name,
  description,
  detection,
});

const BOTH: Vertical[] = ["industrial_utility", "data_center"];
const UTILITY: Vertical[] = ["industrial_utility"];
const DATA_CENTER: Vertical[] = ["data_center"];

export const ASSET_CLASS_LIBRARY: AssetClassDef[] = [
  // ---------------------------------------------------------------- Rotating
  {
    code: "PUMP-CENT",
    name: "Centrifugal pump",
    category: "Rotating",
    verticals: BOTH,
    description: "Any centrifugal pump: end-suction, split-case, vertical turbine or multistage. The driver is its own asset.",
    attributes: [
      pick("configuration", "Configuration", ["End suction", "Horizontal split case", "Vertical turbine", "Multistage"]),
      num("rated_flow", "Rated flow", "gpm"),
      num("rated_head", "Rated head", "ft"),
      num("speed", "Speed", "rpm"),
      pick("seal_type", "Shaft seal", ["Packing", "Single mechanical", "Double mechanical"]),
      text("impeller_material", "Impeller material", false),
    ],
    failureModes: [
      fm("LOO", "Low output", "Flow or head below the duty point: impeller or wear-ring wear, recirculation, suction restriction, air entrainment.", "Flow and discharge pressure trend against the pump curve; performance test."),
      fm("ELP", "External leakage, process medium", "Leakage at the shaft seal or casing joint above the seal's allowable rate.", "Operator rounds; seal leak rate check."),
      fm("VIB", "Vibration", "Overall or bearing-frequency vibration above alarm: misalignment, imbalance, soft foot, bearing wear, cavitation.", "Route-based or online vibration analysis against baseline."),
      fm("OHE", "Overheating", "Bearing housing temperature high: lubrication failure, overgreasing, bearing distress.", "Temperature on rounds, thermography, oil analysis."),
      fm("BRD", "Breakdown", "Pump seized or will not turn: bearing collapse, impeller rub, foreign object.", "Found on start attempt or trip."),
      fm("STD", "Structural deficiency", "Baseplate, grout, anchor bolt or pipe support failure that lets the pump move out of alignment.", "Visual inspection, soft-foot and alignment checks."),
    ],
  },
  {
    code: "PUMP-PD",
    name: "Positive displacement pump",
    category: "Rotating",
    verticals: UTILITY,
    description: "Diaphragm metering, progressive cavity and gear pumps, including chemical feed pumps.",
    attributes: [
      pick("configuration", "Configuration", ["Diaphragm metering", "Progressive cavity", "Gear"]),
      num("rated_flow", "Rated flow", "gph"),
      num("max_pressure", "Maximum discharge pressure", "psi"),
      text("wetted_material", "Wetted material"),
    ],
    failureModes: [
      fm("ERO", "Erratic output", "Dosing rate unstable or below setpoint: check-valve fouling, loss of prime, gas lock.", "Calibration column draw-down; residual trend downstream."),
      fm("ELP", "External leakage, process medium", "Chemical leak at the head, fittings or a ruptured diaphragm.", "Leak detection port, containment inspection, operator rounds."),
      fm("FTS", "Fail to start on demand", "Pump does not run when called: drive, controller or signal fault.", "Run status versus command in the control system."),
      fm("HIO", "High output", "Overfeed: failed check valve siphoning, setpoint or signal error.", "Downstream analyzer trend; draw-down check."),
    ],
  },
  {
    code: "MOTOR-IND",
    name: "Induction motor",
    category: "Rotating",
    verticals: BOTH,
    description: "AC induction motors driving pumps, fans, blowers and compressors.",
    attributes: [
      num("rated_power", "Rated power", "hp"),
      num("voltage", "Voltage", "V"),
      num("speed", "Speed", "rpm"),
      text("frame", "Frame"),
      pick("enclosure", "Enclosure", ["TEFC", "ODP", "WPII", "TENV"]),
      pick("insulation_class", "Insulation class", ["B", "F", "H"], false),
    ],
    failureModes: [
      fm("FTS", "Fail to start on demand", "Motor does not start: supply, starter, overload or winding fault.", "Start attempt; insulation resistance and winding resistance tests."),
      fm("UST", "Spurious stop", "Motor trips while running: overload, ground fault, phase loss.", "Protective relay or overload trip record; current trend."),
      fm("VIB", "Vibration", "Vibration above alarm: bearing wear, rotor bar defect, misalignment, soft foot.", "Vibration analysis including current signature."),
      fm("OHE", "Overheating", "Winding or bearing temperature high: blocked cooling, overload, voltage imbalance.", "RTDs, thermography, current and voltage balance."),
      fm("INS", "Insulation breakdown", "Winding insulation degraded to the point of ground fault or turn-to-turn short.", "Insulation resistance, polarization index, surge test."),
    ],
  },
  {
    code: "VFD",
    name: "Variable frequency drive",
    category: "Electrical power",
    verticals: BOTH,
    description: "Low-voltage AC drives for motor speed control.",
    attributes: [
      num("rated_power", "Rated power", "hp"),
      num("input_voltage", "Input voltage", "V"),
      num("rated_current", "Rated output current", "A"),
      text("firmware", "Firmware version", false),
    ],
    failureModes: [
      fm("UST", "Spurious stop", "Drive trips on fault while running: overcurrent, DC bus over/undervoltage, ground fault.", "Drive fault log."),
      fm("FTS", "Fail to start on demand", "Drive does not respond to a run command: control power, interlock or communication fault.", "Run command versus status; fault log."),
      fm("OHE", "Overheating", "Heatsink temperature high: cooling fan failure, clogged filter, high ambient.", "Drive temperature parameter, thermography, filter inspection."),
      fm("PDE", "Parameter deviation", "DC bus capacitors aged: ripple rising, capacity falling.", "Capacitor health monitoring; ripple measurement."),
    ],
  },
  {
    code: "BLOWER-PD",
    name: "Positive displacement blower",
    category: "Rotating",
    verticals: UTILITY,
    description: "Rotary lobe blowers for air scour and aeration.",
    attributes: [
      num("rated_flow", "Rated flow", "scfm"),
      num("discharge_pressure", "Discharge pressure", "psig"),
      pick("drive", "Drive", ["Belt", "Direct"]),
      num("rated_power", "Motor power", "hp", false),
    ],
    failureModes: [
      fm("OHE", "Overheating", "Discharge or oil temperature high: high pressure ratio, low oil, blocked inlet filter.", "Discharge temperature, oil level, filter differential pressure."),
      fm("VIB", "Vibration", "Vibration above alarm: bearing or timing gear wear, lobe contact.", "Vibration analysis."),
      fm("LOO", "Low output", "Air flow below demand: belt slip, internal clearance wear, relief valve lifting.", "Flow and pressure trend; belt tension check."),
      fm("ELU", "External leakage, utility medium", "Lube oil leaking from seals or gear case.", "Oil level trend, visual inspection."),
    ],
  },
  {
    code: "COMP-SCREW",
    name: "Rotary screw compressor",
    category: "Rotating",
    verticals: UTILITY,
    description: "Plant and instrument air compressors.",
    attributes: [
      num("rated_flow", "Rated flow", "scfm"),
      num("pressure", "Discharge pressure", "psig"),
      num("rated_power", "Motor power", "hp"),
      pick("lubrication", "Lubrication", ["Oil-flooded", "Oil-free"]),
    ],
    failureModes: [
      fm("UST", "Spurious stop", "Trip on high discharge temperature: fouled cooler, low oil, thermostatic valve fault.", "Controller trip log; discharge temperature trend."),
      fm("LOO", "Low output", "Delivered air below demand: inlet valve fault, air-end wear, leaks downstream.", "Load/unload cycle trend; pressure decay test."),
      fm("PDE", "Parameter deviation", "Oil carryover above specification: separator element failure.", "Separator differential pressure; downstream oil check."),
      fm("VIB", "Vibration", "Air-end or motor vibration above alarm.", "Vibration analysis."),
    ],
  },
  {
    code: "FAN-CT",
    name: "Cooling tower fan and gearbox",
    category: "HVAC and cooling",
    verticals: BOTH,
    description: "Axial fans with right-angle gearboxes on cooling towers.",
    attributes: [
      num("diameter", "Fan diameter", "ft"),
      text("gear_ratio", "Gearbox ratio"),
      num("motor_power", "Motor power", "hp"),
      text("blade_material", "Blade material", false),
    ],
    failureModes: [
      fm("VIB", "Vibration", "Fan vibration high: blade pitch or imbalance, gear wear, shaft misalignment.", "Vibration switch trips; vibration analysis."),
      fm("ELU", "External leakage, utility medium", "Gearbox oil leak at seals or the oil fill line.", "Oil level, visual inspection."),
      fm("BRD", "Breakdown", "Gearbox or drive shaft failure.", "Found on trip or rounds; oil analysis wear metals beforehand."),
      fm("STD", "Structural deficiency", "Fan deck, stack or support structure deterioration.", "Annual structural inspection."),
    ],
  },
  {
    code: "SCREEN-TWS",
    name: "Traveling water screen",
    category: "Rotating",
    verticals: UTILITY,
    description: "Intake screens that remove debris ahead of raw water pumps.",
    attributes: [
      num("width", "Screen width", "ft"),
      num("mesh_opening", "Mesh opening", "mm"),
      num("drive_power", "Drive power", "hp", false),
    ],
    failureModes: [
      fm("BRD", "Breakdown", "Screen stops: shear pin, chain or drive failure.", "Drive status; shear pin inspection."),
      fm("PLU", "Plugged", "Differential across the screen high: wash spray failure or debris load beyond capacity.", "Differential level alarm."),
      fm("STD", "Structural deficiency", "Damaged mesh panels or seals letting debris carry over.", "Inspection during dewatering; pump strainer debris."),
    ],
  },
  // -------------------------------------------------------- Electrical power
  {
    code: "XFMR-LIQ",
    name: "Liquid-filled transformer",
    category: "Electrical power",
    verticals: BOTH,
    description: "Oil-filled power transformers at the service entrance or substation.",
    attributes: [
      num("rating", "Rating", "kVA"),
      num("primary_voltage", "Primary voltage", "kV"),
      num("secondary_voltage", "Secondary voltage", "V"),
      pick("cooling_class", "Cooling class", ["ONAN", "ONAF", "ONAN/ONAF"]),
      pick("fluid", "Insulating fluid", ["Mineral oil", "Natural ester", "Silicone"]),
    ],
    failureModes: [
      fm("INS", "Insulation degradation", "Paper and oil insulation breaking down: rising combustible gases, moisture, acidity.", "Dissolved gas analysis and oil quality tests."),
      fm("ELU", "External leakage, utility medium", "Oil leaking from gaskets, valves or radiators.", "Visual inspection, oil level gauge."),
      fm("OHE", "Overheating", "Top oil or winding temperature high: overload, cooling failure, internal hot spot.", "Temperature gauges, thermography, DGA."),
      fm("BRD", "Breakdown", "Bushing failure or internal fault that trips the transformer offline.", "Protective relay operation."),
    ],
  },
  {
    code: "SWGR",
    name: "Switchgear",
    category: "Electrical power",
    verticals: BOTH,
    description: "Low- and medium-voltage switchgear lineups and their power circuit breakers.",
    attributes: [
      pick("voltage_class", "Voltage class", ["LV", "MV"]),
      num("bus_rating", "Bus rating", "A"),
      pick("breaker_type", "Breaker type", ["Air", "Vacuum", "SF6"]),
      flag("arc_resistant", "Arc-resistant construction"),
    ],
    failureModes: [
      fm("FTO", "Fail to open on demand", "Breaker does not trip when protection calls: mechanism binding, trip coil, relay fault.", "Breaker timing and trip tests; relay testing."),
      fm("FTC", "Fail to close on demand", "Breaker does not close: charging motor, close coil or interlock fault.", "Operation test."),
      fm("OHE", "Overheating", "Hot connections or contacts: loose bolting, degraded joints.", "Infrared inspection; contact resistance test."),
      fm("INS", "Insulation degradation", "Partial discharge or tracking on insulation.", "Partial discharge survey; insulation resistance."),
    ],
  },
  {
    code: "MCC",
    name: "Motor control center",
    category: "Electrical power",
    verticals: UTILITY,
    description: "480 V motor control centers with combination starters.",
    attributes: [
      num("voltage", "Voltage", "V"),
      num("bus_rating", "Bus rating", "A"),
      num("sections", "Sections", "ea"),
    ],
    failureModes: [
      fm("FTS", "Fail to start on demand", "Starter bucket does not energize its motor: contactor, control transformer or overload fault.", "Start command versus status."),
      fm("OHE", "Overheating", "Hot stab, lug or bus connection.", "Infrared inspection."),
      fm("FTO", "Fail to open on demand", "Breaker or fuse fails to clear a fault.", "Breaker testing; trip records."),
    ],
  },
  {
    code: "GEN-DIESEL",
    name: "Diesel generator",
    category: "Electrical power",
    verticals: BOTH,
    description: "Standby or prime diesel generator sets, including their starting system and day tank.",
    attributes: [
      num("rating", "Rating", "kW"),
      num("voltage", "Voltage", "V"),
      num("fuel_capacity", "Fuel capacity", "gal"),
      pick("epss_level", "Emergency power level", ["Level 1", "Level 2", "Not classified"]),
    ],
    failureModes: [
      fm("FTS", "Fail to start on demand", "Engine does not start within the required time: starting battery, starter, fuel or control fault.", "Weekly or monthly start test; battery and charger checks."),
      fm("LOO", "Low output", "Starts but cannot carry rated load: governor, voltage regulator or fuel delivery fault.", "Load bank test; transfer test."),
      fm("UST", "Spurious stop", "Shuts down on a protective fault while running: high coolant temperature, low oil pressure, overspeed.", "Controller event log."),
      fm("PDE", "Parameter deviation", "Fuel degraded or contaminated: water, microbial growth, oxidation.", "Periodic fuel sampling."),
    ],
  },
  {
    code: "UPS-STATIC",
    name: "Static UPS module",
    category: "Electrical power",
    verticals: DATA_CENTER,
    description: "Double-conversion UPS modules feeding critical load. The battery string is its own asset.",
    attributes: [
      num("rating", "Rating", "kVA"),
      pick("redundancy", "System redundancy", ["N", "N+1", "2N", "2N+1"]),
      pick("energy_storage", "Energy storage", ["VRLA", "Li-ion", "Flywheel"]),
      text("firmware", "Firmware version", false),
    ],
    failureModes: [
      fm("SPO", "Spurious operation", "Unplanned transfer to static bypass on an internal fault, leaving load on raw utility.", "UPS event log; BMS/EPMS alarm."),
      fm("FTF", "Fail to function on demand", "Does not carry load on utility loss: inverter, rectifier or battery fault.", "Load bank and transfer testing during maintenance windows."),
      fm("PDE", "Parameter deviation", "AC or DC capacitors aged beyond service life; fans worn.", "OEM preventive inspection; capacitor replacement schedule."),
      fm("OHE", "Overheating", "Module temperature high: fan failure, filter loading, room cooling loss.", "Module temperature alarms; thermography."),
    ],
  },
  {
    code: "BATT-STRING",
    name: "Battery string",
    category: "Electrical power",
    verticals: BOTH,
    description: "Stationary battery strings for UPS systems, switchgear control power and generator starting.",
    attributes: [
      pick("chemistry", "Chemistry", ["VRLA", "Vented lead-acid", "Li-ion", "NiCd"]),
      num("jars", "Jars or modules", "ea"),
      num("capacity", "Rated capacity", "Ah"),
      flag("monitored", "Continuous monitoring"),
    ],
    failureModes: [
      fm("LOO", "Low capacity", "String cannot deliver rated runtime: aged or failed cells.", "Capacity (discharge) test."),
      fm("PDE", "Parameter deviation", "Cell internal resistance or float voltage outside limits.", "Ohmic testing; monitoring system trend."),
      fm("OHE", "Overheating", "Cell temperature high; risk of thermal runaway.", "Temperature monitoring; thermography."),
      fm("STD", "Structural deficiency", "Jar swelling, cracked cases, corroded terminals or high connection resistance.", "Visual inspection; intercell connection resistance."),
    ],
  },
  {
    code: "STS",
    name: "Static transfer switch",
    category: "Electrical power",
    verticals: DATA_CENTER,
    description: "Solid-state switches selecting between two sources for single-corded load.",
    attributes: [
      num("rating", "Rating", "A"),
      num("voltage", "Voltage", "V"),
      pick("poles", "Poles", ["3", "4"]),
    ],
    failureModes: [
      fm("FTF", "Fail to function on demand", "Does not transfer when the preferred source fails: SCR or control fault.", "Functional transfer test during a maintenance window."),
      fm("SPO", "Spurious operation", "Transfers without a source problem: sensing or control fault.", "Event log review."),
      fm("OHE", "Overheating", "SCR heatsink or connection temperature high.", "Thermography; fan inspection."),
    ],
  },
  {
    code: "ATS",
    name: "Automatic transfer switch",
    category: "Electrical power",
    verticals: BOTH,
    description: "Electromechanical transfer switches between utility and generator.",
    attributes: [
      num("rating", "Rating", "A"),
      num("voltage", "Voltage", "V"),
      pick("transition", "Transition", ["Open", "Closed", "Delayed"]),
    ],
    failureModes: [
      fm("FTF", "Fail to function on demand", "Does not transfer to the emergency source on utility loss.", "Monthly transfer test with the generator."),
      fm("DOP", "Delayed operation", "Transfer or retransfer slower than set: timer or mechanism fault.", "Transfer timing recorded during tests."),
      fm("OHE", "Overheating", "Contacts or terminations running hot.", "Infrared inspection; contact inspection."),
    ],
  },
  {
    code: "PDU",
    name: "Power distribution unit",
    category: "Electrical power",
    verticals: DATA_CENTER,
    description: "Floor-standing PDUs and remote power panels distributing UPS power to racks.",
    attributes: [
      num("rating", "Rating", "kVA"),
      num("input_voltage", "Input voltage", "V"),
      num("output_voltage", "Output voltage", "V"),
      flag("branch_monitoring", "Branch circuit monitoring"),
    ],
    failureModes: [
      fm("UST", "Spurious stop", "Branch or main breaker trips: overload, fault on a rack feed.", "Branch monitoring alarm; breaker position."),
      fm("OHE", "Overheating", "Hot connections or transformer temperature high.", "Infrared inspection; transformer temperature."),
      fm("AIR", "Abnormal instrument reading", "Branch metering wrong or missing, hiding real load.", "Meter comparison against a reference reading."),
    ],
  },
  // ----------------------------------------------------- Static and pressure
  {
    code: "BOILER-FT",
    name: "Firetube boiler",
    category: "Static and pressure",
    verticals: UTILITY,
    description: "Packaged firetube steam or hot water boilers with their burner management.",
    attributes: [
      num("capacity", "Capacity", "bhp"),
      num("operating_pressure", "Operating pressure", "psig"),
      pick("fuel", "Fuel", ["Natural gas", "Fuel oil", "Dual fuel"]),
    ],
    failureModes: [
      fm("FTS", "Fail to start on demand", "Burner fails to light or proves no flame: ignition, flame scanner or fuel train fault.", "Burner management lockout record."),
      fm("UST", "Spurious stop", "Trip on low water, high pressure or flame failure while running.", "Trip log; low-water cutoff testing."),
      fm("ELP", "External leakage, process medium", "Tube or tubesheet leak.", "Hydrostatic test; internal inspection."),
      fm("PDE", "Parameter deviation", "Stack temperature or fuel use rising: fireside fouling or waterside scale.", "Combustion analysis; stack temperature trend."),
    ],
  },
  {
    code: "VESSEL",
    name: "Pressure vessel",
    category: "Static and pressure",
    verticals: UTILITY,
    description: "Deaerators, receivers and other code pressure vessels.",
    attributes: [
      num("design_pressure", "Design pressure", "psig"),
      num("design_temperature", "Design temperature", "°F"),
      text("contents", "Contents"),
      text("registration", "Jurisdiction registration", false),
    ],
    failureModes: [
      fm("ELP", "External leakage, process medium", "Leak through a weld, nozzle or gasket.", "Visual inspection."),
      fm("STD", "Structural deficiency", "Wall thinning, cracking or internal damage: corrosion, erosion, fatigue.", "Thickness survey; internal inspection; wet fluorescent magnetic particle at welds."),
      fm("FTO", "Fail to open on demand", "Pressure relief device does not lift at set pressure.", "Relief valve bench test or replacement on interval."),
    ],
  },
  {
    code: "TANK",
    name: "Atmospheric storage tank",
    category: "Static and pressure",
    verticals: BOTH,
    description: "Chemical, fuel and water storage tanks.",
    attributes: [
      num("capacity", "Capacity", "gal"),
      text("material", "Material"),
      text("contents", "Contents"),
      flag("secondary_containment", "Secondary containment"),
    ],
    failureModes: [
      fm("ELP", "External leakage, process medium", "Leak from the shell, a nozzle or a fitting.", "Containment and visual inspection."),
      fm("STD", "Structural deficiency", "Cracking, UV degradation, corrosion or settlement.", "Periodic tank inspection."),
      fm("AIR", "Abnormal instrument reading", "Level indication wrong, leading to overfill or run-dry.", "Level instrument comparison against manual gauge."),
    ],
  },
  {
    code: "DRYER-DES",
    name: "Desiccant air dryer",
    category: "Static and pressure",
    verticals: UTILITY,
    description: "Heatless or heated desiccant dryers for instrument air.",
    attributes: [
      num("rated_flow", "Rated flow", "scfm"),
      num("dewpoint", "Rated pressure dewpoint", "°F"),
      pick("regeneration", "Regeneration", ["Heatless", "Heated", "Blower purge"]),
    ],
    failureModes: [
      fm("PDE", "Parameter deviation", "Outlet dewpoint above specification: desiccant degraded, purge too low.", "Dewpoint monitor trend."),
      fm("FTF", "Fail to function on demand", "Tower switching or purge valves stuck.", "Cycle observation; valve inspection."),
      fm("PLU", "Plugged", "Pressure drop high: pre- or after-filter loading.", "Filter differential pressure."),
    ],
  },
  // ------------------------------------------------------------------ Valves
  {
    code: "VALVE-CHECK",
    name: "Check valve",
    category: "Valves",
    verticals: BOTH,
    description: "Swing, tilting-disc and dual-plate check valves on pump discharges.",
    attributes: [
      num("size", "Size", "in"),
      pick("valve_type", "Type", ["Swing", "Tilting disc", "Dual plate", "Silent"]),
      text("pressure_class", "Pressure class"),
    ],
    failureModes: [
      fm("FTC", "Fail to close on demand", "Does not close on pump stop, allowing reverse flow and reverse rotation.", "Reverse rotation on stop; acoustic monitoring."),
      fm("INL", "Internal leakage", "Seat leakage back through a stopped pump.", "Standby pump pressure and rotation check."),
      fm("NOI", "Noise", "Slam on closure: worn hinge, wrong type for the system.", "Operator report; pressure transient recording."),
    ],
  },
  {
    code: "VALVE-ACT",
    name: "Actuated valve",
    category: "Valves",
    verticals: BOTH,
    description: "Automated isolation and control valves with electric or pneumatic actuators.",
    attributes: [
      num("size", "Size", "in"),
      pick("valve_type", "Valve type", ["Butterfly", "Ball", "Gate", "Globe"]),
      pick("actuator", "Actuator", ["Electric", "Pneumatic", "Hydraulic"]),
      pick("fail_position", "Fail position", ["Open", "Closed", "Last position"]),
    ],
    failureModes: [
      fm("FTO", "Fail to open on demand", "Does not open when commanded: actuator, torque switch or binding.", "Stroke test; command versus position feedback."),
      fm("FTC", "Fail to close on demand", "Does not close when commanded.", "Stroke test."),
      fm("DOP", "Delayed operation", "Stroke time longer than specified.", "Stroke timing trend."),
      fm("INL", "Internal leakage", "Seat leakage when closed.", "Downstream pressure or flow with the valve closed."),
      fm("AIR", "Abnormal instrument reading", "Position feedback wrong or lost.", "Feedback versus local position indicator."),
    ],
  },
  // --------------------------------------------- Instrumentation and controls
  {
    code: "ANALYZER",
    name: "Process analyzer",
    category: "Instrumentation and controls",
    verticals: UTILITY,
    description: "Online water quality and process analyzers, including compliance analyzers.",
    attributes: [
      text("parameter", "Measured parameter"),
      text("range", "Range"),
      text("method", "Measurement method"),
      flag("compliance", "Used for regulatory compliance"),
    ],
    failureModes: [
      fm("ERO", "Erratic output", "Reading drifts or disagrees with grab samples.", "Grab-sample comparison and calibration verification."),
      fm("NOO", "No output", "Analyzer offline or signal lost.", "Signal status in the control system."),
      fm("PLU", "Plugged", "Sample line or flow cell plugged; sample flow lost.", "Sample flow indicator."),
    ],
  },
  {
    code: "BMS-CTRL",
    name: "BMS or EPMS controller",
    category: "Instrumentation and controls",
    verticals: DATA_CENTER,
    description: "Building and electrical power monitoring controllers and their network gateways.",
    attributes: [
      pick("system", "System", ["BMS", "EPMS"]),
      pick("protocol", "Protocol", ["BACnet", "Modbus", "SNMP"]),
      text("firmware", "Firmware version"),
    ],
    failureModes: [
      fm("NOO", "No output", "Controller or gateway offline; points stale.", "Communication status alarms; stale-point report."),
      fm("AIR", "Abnormal instrument reading", "A sensor or meter reading wrong, so alarms and trends mislead.", "Point-to-point verification against a reference instrument."),
      fm("FTF", "Fail to function on demand", "Alarm not annunciated or sequence not executed when required.", "Alarm and sequence testing."),
    ],
  },
  // -------------------------------------------------------- HVAC and cooling
  {
    code: "CHILLER",
    name: "Water-cooled chiller",
    category: "HVAC and cooling",
    verticals: DATA_CENTER,
    description: "Centrifugal, screw and magnetic-bearing chillers on the chilled water plant.",
    attributes: [
      num("capacity", "Capacity", "tons"),
      pick("compressor", "Compressor", ["Centrifugal", "Screw", "Magnetic bearing centrifugal"]),
      text("refrigerant", "Refrigerant"),
    ],
    failureModes: [
      fm("FTS", "Fail to start on demand", "Chiller does not start on staging call: interlock, flow switch or compressor fault.", "Staging command versus status; controller alarms."),
      fm("UST", "Spurious stop", "Trip on high condenser pressure or low evaporator pressure: fouled tubes, low flow, low charge.", "Controller trip log; approach temperature trend."),
      fm("ELU", "External leakage, utility medium", "Refrigerant leak.", "Refrigerant monitor; leak check; charge records."),
      fm("PDE", "Parameter deviation", "Efficiency falling: approach temperatures rising, oil degraded.", "kW/ton and approach trend; oil analysis; eddy current tube testing."),
    ],
  },
  {
    code: "CRAH",
    name: "Computer room air handler",
    category: "HVAC and cooling",
    verticals: DATA_CENTER,
    description: "CRAH and CRAC units cooling data halls.",
    attributes: [
      num("capacity", "Cooling capacity", "kW"),
      pick("fan_type", "Fan type", ["EC plug", "Belt-driven centrifugal"]),
      pick("cooling_medium", "Cooling medium", ["Chilled water", "DX", "Pumped refrigerant"]),
    ],
    failureModes: [
      fm("BRD", "Breakdown", "Fan or motor failure, losing airflow to the hall.", "Unit alarm; airflow and supply temperature."),
      fm("FTF", "Fail to function on demand", "Chilled water valve stuck or controller fault; unit cannot meet setpoint.", "Valve stroke test; supply air temperature trend."),
      fm("PLU", "Plugged", "Filters loaded; airflow reduced.", "Filter differential pressure."),
      fm("ELP", "External leakage, process medium", "Condensate or chilled water leak under the floor.", "Leak detection cable alarm."),
    ],
  },
  {
    code: "CDU",
    name: "Coolant distribution unit",
    category: "HVAC and cooling",
    verticals: DATA_CENTER,
    description: "Liquid cooling CDUs: heat exchanger, pumps and filtration between facility water and the rack secondary loop.",
    attributes: [
      num("capacity", "Heat rejection capacity", "kW"),
      text("secondary_fluid", "Secondary fluid"),
      pick("pump_redundancy", "Pump redundancy", ["N", "N+1"]),
      num("filtration", "Filtration", "micron"),
    ],
    failureModes: [
      fm("ELP", "External leakage, process medium", "Secondary loop leak at the CDU, manifold or quick disconnects.", "Leak detection; loop pressure and reservoir level trend."),
      fm("LOO", "Low output", "Secondary flow below requirement: pump wear, clogged strainer or filter.", "Flow and differential pressure trend."),
      fm("PDE", "Parameter deviation", "Coolant quality out of range: conductivity, pH, inhibitor or biological growth.", "Periodic fluid sampling."),
      fm("BRD", "Breakdown", "Pump failure.", "Pump status; redundancy alarm."),
    ],
  },
  // ---------------------------------------------------------- Fire protection
  {
    code: "FIRE-SUPP",
    name: "Fire suppression system",
    category: "Fire protection",
    verticals: DATA_CENTER,
    description: "Pre-action sprinkler and clean agent systems with their detection and release panels.",
    attributes: [
      pick("system_type", "System type", ["Pre-action sprinkler", "Clean agent", "Water mist"]),
      text("agent", "Agent or medium"),
      text("protected_area", "Protected area"),
    ],
    failureModes: [
      fm("FTF", "Fail to function on demand", "Does not release or trip when detection calls.", "Periodic inspection and testing; trip test."),
      fm("SPO", "Spurious operation", "Inadvertent discharge or pre-action trip.", "Panel event log."),
      fm("PDE", "Parameter deviation", "Agent quantity or supervisory air pressure below requirement.", "Agent weighing or level check; supervisory pressure monitoring."),
    ],
  },
];

export function findClassDef(code: string): AssetClassDef {
  const def = ASSET_CLASS_LIBRARY.find((c) => c.code === code);
  if (!def) throw new Error(`Unknown asset class ${code}`);
  return def;
}
