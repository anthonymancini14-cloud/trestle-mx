/**
 * Load the fictional demo sites (Cedar Flats Data Center and Basalt Ridge
 * Plant) into a Supabase project.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SEED_PASSWORD=... pnpm seed:live
 *
 * Creates one auth user per seed profile (<first>@demo.trestle.mx), then
 * inserts the same dataset the demo mode uses. Uses the service role key, so
 * run it from your machine only — never ship that key to the browser.
 */
import { createClient } from "@supabase/supabase-js";
import { buildDataset } from "../lib/demo/dataset";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.SEED_PASSWORD;

if (!url || !serviceKey || !password) {
  console.error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SEED_PASSWORD.");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

async function insert(table: string, rows: object[]) {
  if (rows.length === 0) return;
  const { error } = await admin.from(table).upsert(rows);
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`  ${table}: ${rows.length}`);
}

async function main() {
  const db = buildDataset();
  const idMap = new Map<string, string>();

  console.log("Creating demo users");
  for (const person of db.profiles) {
    const email = `${person.full_name.split(" ")[0].toLowerCase()}@demo.trestle.mx`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: person.full_name },
    });
    let userId = data.user?.id;
    if (error) {
      // Already exists from an earlier run: look it up.
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
      userId = list.users.find((u) => u.email === email)?.id;
      if (!userId) throw error;
    }
    idMap.set(person.id, userId!);
    console.log(`  ${email} (${person.role})`);
  }
  const mapPerson = (id: string | null) => (id ? idMap.get(id) ?? null : null);

  console.log("Loading site data");
  await insert("organizations", [db.org]);
  await insert("sites", db.sites);
  await insert("area_codes", db.areas);
  await insert(
    "profiles",
    db.profiles.map((p) => ({ ...p, id: mapPerson(p.id) })),
  );
  await insert(
    "site_access",
    db.siteAccess.map((a) => ({ user_id: mapPerson(a.user_id), site_id: a.site_id })),
  );
  await insert("asset_classes", db.assetClasses);
  await insert("asset_class_failure_modes", db.failureModes);
  // Parents first so the self-reference resolves.
  await insert("assets", db.assets.map((a) => ({ ...a, parent_id: null })));
  await insert("assets", db.assets.filter((a) => a.parent_id));
  await insert("cable_routes", db.cableRoutes);
  await insert("parts_catalog", db.parts);
  await insert("inventory", db.inventory);
  await insert("pm_tasks", db.pmTasks);
  await insert("asset_class_spares", db.classSpares);
  await insert("pm_schedules", db.pmSchedules);
  await insert("pm_deferrals", db.pmDeferrals.map((d) => ({ ...d, approved_by: mapPerson(d.approved_by) })));
  await insert("crew_shifts", db.crewShifts.map((c) => ({ ...c, profile_id: mapPerson(c.profile_id) })));
  await insert("time_off", db.timeOff.map((t) => ({ ...t, profile_id: mapPerson(t.profile_id), created_by: mapPerson(t.created_by) })));
  await insert(
    "work_orders",
    db.workOrders.map((w) => ({
      ...w,
      reported_by: mapPerson(w.reported_by),
      planner_id: mapPerson(w.planner_id),
      assigned_to: mapPerson(w.assigned_to),
    })),
  );
  await insert("wo_tasks", db.tasks);
  await insert("wo_parts", db.woParts);
  await insert("wo_events", db.events.map((e) => ({ ...e, actor_id: mapPerson(e.actor_id) })));
  console.log("Done. Sign in as owen@demo.trestle.mx (data center planner) or marcus@demo.trestle.mx (plant planner).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
