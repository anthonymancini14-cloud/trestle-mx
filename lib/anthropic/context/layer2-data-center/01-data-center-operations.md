# Data center operations

Context for planning maintenance in an operating data center. General practice, paraphrased; the site's methods of procedure, change management and the authority having jurisdiction govern.

## Redundancy comes first

- Know the redundancy of the system being worked on: N (no spare), N+1 (one spare unit), 2N (two independent A and B paths). Dual-corded IT loads take power from both the A and B sides.
- Any work that removes a component reduces redundancy. Taking a UPS module, PDU or power whip on the A side out of service leaves those loads on the B side alone, at N. Say so in the plan, and confirm the remaining path is healthy (no active alarms, no other planned work on it) before isolation.
- Never plan concurrent work that removes both paths to the same load.

## Method of procedure (MOP) and change windows

- Work that touches critical power, cooling or network paths is done under a written MOP: scope, risk, prerequisites, step-by-step actions with hold points, verification after each step, and a back-out (rollback) step for each stage.
- Schedule it in an approved change window. The plan's steps should read like a MOP: confirm prerequisites, notify, isolate, work, verify, restore, confirm.
- Tenant or network operations notification: list who must be told before and after, and when.

## Critical environment practice

- Work above or inside live cabinets: no tools or materials left on top of cabinets, protect equipment from debris, keep hot and cold aisle containment closed where possible.
- Lifts in data halls: check floor loading and protect raised floor tiles; spotter in narrow aisles.

## Power equipment

- UPS modules: maintenance bypass transfers are planned steps with verification; battery work follows the manufacturer's procedure (Li-ion and VRLA differ). Thermal scans are done under load.
- Generators: monthly runs and periodic load bank tests; while a generator is out of service, the site has reduced standby capacity.
- PDUs and remote power panels: branch breaker work on a live panel is energized work and needs the site's electrical safety program; prefer isolating the branch feeding a single-corded or dual-corded load after confirming the other cord is live.

## Cooling

- Chilled water plants run N+1 chillers and pumps; take one out only when the rest can carry the load with margin for the outdoor conditions.
- Liquid cooling (CDUs, direct-to-chip): the secondary loop serves IT hardware directly. Keep the redundant CDU or pump carrying load before isolating, have spill containment ready, refill with the specified premixed coolant only, and verify flow, pressure and supply temperature before returning to service. Coolant quality (conductivity, inhibitor, biological growth) is sampled on a schedule.
