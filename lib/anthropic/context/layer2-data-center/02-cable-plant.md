# Cable plant: pathways, cables and terminations

General practice, paraphrased. The site's cabling standard and the authority having jurisdiction govern.

## Pathways and tray sections

- Cable pathways are made of labeled tray sections: wire mesh basket tray (common for fiber and copper data above rows), cable ladder rack (backbone runs and heavier bundles) and solid-bottom tray. Every installed cable in Trestle.MX records the sections it runs through, end A to end B. Name those sections by tag in the plan so the crew works in the right tray.
- Keep power and data in separate pathways, or separated by a grounded metallic divider. Communications cable is kept at least 2 in from power conductors unless a barrier or raceway separates them; heavier circuits need more separation.
- Fill: design for about 25% initial fill so there is room for growth; do not exceed about 50% fill or stack cable deeper than about 6 in. Adding cable to a section near its limit is a reason to raise a pathway work order.
- Drop-outs from tray into cabinets need radius control (waterfall fittings). A missing waterfall is a common cause of bend damage.
- Tray sections are bonded to the grounding system; replacing or adding a section includes bonding jumpers.

## Bend radius and handling

- Fiber cable: minimum bend radius is about 20 times the cable outer diameter while pulling under tension and about 10 times once installed with no tension, unless the manufacturer states otherwise. Use the outer diameter from the storeroom spec to give the number in the plan.
- Do not exceed the manufacturer's pulling tension; pull by the cable's pulling eye or grip, never by the connectors. Pre-terminated trunks are laid in, not pulled hard.

## Terminations and testing

- Inspect and clean every fiber connector end face before it is mated, every time, with an inspection scope. Most fiber faults at installation are dirty connectors.
- Use the exact replacement: fiber type, fiber count, connector type and gender (for example MPO-24 female), polish (APC or UPC) and polarity method (for example Type B) must match the existing channel.
- Test after replacement: light source and power meter against the link loss budget for each fiber or lane, and an OTDR trace where the original fault was located by OTDR. Record results against the cable.
- Power whips: torque lugs to the manufacturer's value, verify phasing and receptacle type, and confirm the rack PDU on the other feed carried the load before the whip was disconnected.

## Labels and records

- Label each cable at both ends and each tray section, matching the cable record (TIA-606 style administration). A replacement cable takes the same identifier as the one it replaces; update the record if the route or length changed.

## Abandoned cable

- The NEC requires removing the accessible portion of abandoned cable (Article 770 for optical fiber, Article 800 for communications cable). A replaced cable is removed from the tray, not left in it, unless it is tagged for future use.
