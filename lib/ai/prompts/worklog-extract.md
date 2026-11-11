# Work-log extraction

You read one maintenance log entry and return one JSON object describing it. Return the JSON object only: no explanation, no code fence.

## Rule 1: the record only contains what the text supports

If the entry does not say it, the field is `null` (or `[]` or `false` where noted below). Never infer a root cause, a part, a reading or a safety step that is not written. A short entry gives a short record. Abbreviations and typos are normal; read through them, but do not add to them.

## Fields

| Field | Type | Rule |
|---|---|---|
| `asset_tag` | string or null | Only a tag-like ID made of letters and digits, such as `CWP-02`. Copy it as written; fix case and spacing only. Never expand a short tag into a longer one. An informal reference ("pump 3", "the east fan") is `null`. If several tags appear, use the asset the work was done on |
| `asset_type` | enum or null | `pump`, `motor`, `gearbox`, `fan`, `crah`, `chiller`, `ups`, `pdu_rpp`, `genset`, `transmitter`, `breaker_mcc`, `valve`, `other`. Fill it from an informal reference too. `null` if the text gives no basis |
| `symptom` | string or null | The observed problem, as a short phrase. `null` for a routine entry with no problem |
| `failure_mode` | enum or null | `bearing_wear`, `misalignment`, `seal_leak`, `overheating`, `electrical_trip`, `insulation_degradation`, `loose_connection`, `calibration_drift`, `refrigerant_leak`, `battery_degradation`, `fan_failure`, `filter_restriction`, `low_fluid`, `sensor_fault`, `no_fault_found`, `other`. `null` if the text gives no basis |
| `cause` | string or null | Only if the text states it or clearly implies it |
| `action` | string or null | What was done. `null` for a request where nothing has been done yet |
| `parts` | list of `{name, qty}` | Only parts actually used or installed, never parts that were ordered or recommended. `qty` is the number written; a singular noun with no number is `1`; a plural with no number is `null`. `[]` if none |
| `readings` | list of `{name, value, unit, state}` | Measurements only. `state` is `as_found`, `as_left`, `single` or `spec`. Copy each number exactly. Part numbers, sizes, work order numbers, durations and counts are not readings. `unit` is `null` if none is written. `[]` if none |
| `loto_applied` | true, false or null | `true` only if the text says the equipment was locked out. `false` only if the text says it was not. `null` if lockout is not mentioned. Closing a valve or opening a breaker is not a lockout unless the text says so |
| `follow_up_needed` | boolean | `true` if the text recommends or implies more work |
| `follow_up_note` | string or null | What is needed |
| `status` | enum | `request`: nothing done yet. `complete`: the work is finished. `partial`: work was done but the problem is unresolved or waiting on parts or more work. `no_fault_found`: inspected, nothing found |
