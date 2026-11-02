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
  await insert("failure_codes", db.failureCodes);
  await insert("discrepancy_actions", db.operatorActions.map((a) => ({ ...a, created_by: mapPerson(a.created_by) })));
  await insert("wo_findings", db.findings.map((f) => ({ ...f, created_by: mapPerson(f.created_by) })));
  await insert("wo_resolutions", db.resolutions.map(({ finding_ids: _links, ...r }) => ({ ...r, created_by: mapPerson(r.created_by) })));
  await insert("wo_resolution_findings", db.resolutions.flatMap((r) => r.finding_ids.map((finding_id) => ({ resolution_id: r.id, finding_id }))));
  await insert("wo_addenda", db.addenda.map((a) => ({ ...a, created_by: mapPerson(a.created_by) })));
  // Document control: replacements and pins after every row exists. Seed drawings ship in public/demo-docs.
  await insert("documents", db.documents.map((d) => ({ ...d, replaced_by_id: null, created_by: mapPerson(d.created_by), obsoleted_by: mapPerson(d.obsoleted_by) })));
  await insert("documents", db.documents.filter((d) => d.replaced_by_id).map((d) => ({ ...d, created_by: mapPerson(d.created_by), obsoleted_by: mapPerson(d.obsoleted_by) })));
  await insert(
    "document_revisions",
    db.documentRevisions.map(({ file, ...r }) => ({
      ...r,
      site_id: db.documents.find((d) => d.id === r.document_id)!.site_id,
      prepared_by: mapPerson(r.prepared_by),
      reviewed_by: mapPerson(r.reviewed_by),
      file_name: file?.name ?? null,
      file_mime: file?.mime ?? null,
      file_size: file?.size ?? null,
      storage_path: file?.path ?? null,
    })),
  );
  await insert("document_assets", db.documentAssets);
  await insert("wo_documents", db.woDocuments.map((l) => ({ ...l, pinned_revision_id: null, added_by: mapPerson(l.added_by) })));
  await insert("wo_document_views", db.woDocumentViews.map((v) => ({ ...v, viewed_by: mapPerson(v.viewed_by) })));
  for (const l of db.woDocuments.filter((x) => x.pinned_revision_id)) {
    const { error } = await admin.from("wo_documents").update({ pinned_revision_id: l.pinned_revision_id }).eq("id", l.id).is("pinned_revision_id", null);
    if (error) throw new Error(`wo_documents pin: ${error.message}`);
  }
  console.log("Done. Sign in as owen@demo.trestle.mx (data center planner) or marcus@demo.trestle.mx (plant planner).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
