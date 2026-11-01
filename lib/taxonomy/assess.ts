/**
 * Asset data quality against the class library.
 *
 * A register is only comparable across sites if every asset is classified and
 * carries the attributes its class requires. These pure functions say, for
 * one asset or a whole register, what is missing or wrong. The UI shows the
 * result; nothing here blocks saving an incomplete asset, because real
 * registers are built up over time.
 */
import type { AssetAttributes, AttributeSpec, AttributeValue, Asset, AssetClass } from "@/types/domain";

export interface AttributeIssue {
  spec: AttributeSpec;
  problem: "missing" | "wrong_type" | "not_an_option";
  value?: AttributeValue;
}

export interface AssetAssessment {
  classified: boolean;
  /** Required attributes present and valid, out of required attributes defined. */
  requiredFilled: number;
  requiredTotal: number;
  issues: AttributeIssue[];
  /** Attribute keys on the asset that its class does not define. */
  unknownKeys: string[];
  complete: boolean;
}

function checkValue(spec: AttributeSpec, value: AttributeValue): AttributeIssue["problem"] | null {
  switch (spec.type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : "wrong_type";
    case "boolean":
      return typeof value === "boolean" ? null : "wrong_type";
    case "enum":
      if (typeof value !== "string") return "wrong_type";
      return spec.options?.includes(value) ? null : "not_an_option";
    case "text":
      return typeof value === "string" && value.trim() !== "" ? null : "wrong_type";
  }
}

export function assessAsset(asset: Pick<Asset, "class_id" | "attributes">, cls: AssetClass | null): AssetAssessment {
  if (!asset.class_id || !cls) {
    return { classified: false, requiredFilled: 0, requiredTotal: 0, issues: [], unknownKeys: [], complete: false };
  }
  const attrs: AssetAttributes = asset.attributes ?? {};
  const issues: AttributeIssue[] = [];
  let requiredFilled = 0;
  const required = cls.attributes.filter((s) => s.required);

  for (const spec of cls.attributes) {
    const value = attrs[spec.key];
    if (value === undefined || value === null || value === "") {
      if (spec.required) issues.push({ spec, problem: "missing" });
      continue;
    }
    const problem = checkValue(spec, value);
    if (problem) issues.push({ spec, problem, value });
    else if (spec.required) requiredFilled += 1;
  }

  const known = new Set(cls.attributes.map((s) => s.key));
  const unknownKeys = Object.keys(attrs).filter((k) => !known.has(k));

  return {
    classified: true,
    requiredFilled,
    requiredTotal: required.length,
    issues,
    unknownKeys,
    complete: issues.length === 0 && unknownKeys.length === 0,
  };
}

export interface RegisterQuality {
  total: number;
  classified: number;
  complete: number;
  /** Share of all assets that are classified and complete, 0 to 100. */
  completePct: number;
  /** Required attribute slots filled across classified assets, 0 to 100. */
  attributeFillPct: number;
  byClass: Map<string, { assets: number; complete: number }>;
}

export function assessRegister(assets: Pick<Asset, "class_id" | "attributes">[], classes: AssetClass[]): RegisterQuality {
  const byId = new Map(classes.map((c) => [c.id, c]));
  const byClass = new Map<string, { assets: number; complete: number }>();
  let classified = 0;
  let complete = 0;
  let filled = 0;
  let slots = 0;

  for (const asset of assets) {
    const cls = asset.class_id ? byId.get(asset.class_id) ?? null : null;
    const result = assessAsset(asset, cls);
    if (!result.classified || !cls) continue;
    classified += 1;
    filled += result.requiredFilled;
    slots += result.requiredTotal;
    const row = byClass.get(cls.id) ?? { assets: 0, complete: 0 };
    row.assets += 1;
    if (result.complete) {
      row.complete += 1;
      complete += 1;
    }
    byClass.set(cls.id, row);
  }

  return {
    total: assets.length,
    classified,
    complete,
    completePct: assets.length ? Math.round((complete / assets.length) * 100) : 0,
    attributeFillPct: slots ? Math.round((filled / slots) * 100) : 0,
    byClass,
  };
}

/** Display an attribute value with its unit. */
export function formatAttribute(spec: AttributeSpec, value: AttributeValue | undefined): string {
  if (value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return `${value.toLocaleString("en-US")}${spec.unit ? ` ${spec.unit}` : ""}`;
  return value;
}

/** Classes with no moving parts: they are "in service", not "running". */
const PASSIVE_CLASSES = new Set(["CABLE", "CABLE-TRAY", "CABINET", "TANK", "VESSEL"]);

export function statusLabel(status: Asset["status"], classCode: string | null | undefined): string {
  if (status === "running" && classCode && PASSIVE_CLASSES.has(classCode)) return "In service";
  return status.charAt(0).toUpperCase() + status.slice(1);
}
