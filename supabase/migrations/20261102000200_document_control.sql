-- ============================================================
-- Document control (TMX-026)
--
-- Controlled documents per site: OEM manuals, drawings, technical
-- specifications, procedures and management of change records. Each document
-- has revisions; a revision is written by one person and approved by another,
-- then becomes current and the revision before it is superseded. Revision
-- content never changes. Obsolete documents are archived (kept, read-only)
-- and may name their replacement.
--
-- Documents go on work orders. While a work order is open it shows the
-- current revision and logs each time someone opens a document from it; when
-- it closes, the revision used is pinned to the work order for good.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.doc_type AS ENUM ('oem_manual', 'drawing', 'specification', 'procedure', 'moc');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.doc_status AS ENUM ('active', 'obsolete');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.revision_status AS ENUM ('draft', 'current', 'superseded', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.wo_doc_source AS ENUM ('plan', 'attached', 'opened');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL REFERENCES public.sites(id),
  doc_number      text NOT NULL,
  title           text NOT NULL CHECK (length(trim(title)) >= 3),
  doc_type        public.doc_type NOT NULL,
  status          public.doc_status NOT NULL DEFAULT 'active',
  replaced_by_id  uuid REFERENCES public.documents(id),
  obsolete_reason text,
  obsoleted_by    uuid REFERENCES public.profiles(id),
  obsoleted_at    timestamptz,
  created_by      uuid REFERENCES public.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, doc_number),
  CHECK (replaced_by_id IS DISTINCT FROM id),
  CHECK (status = 'active' OR obsolete_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.document_revisions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    uuid NOT NULL REFERENCES public.documents(id),
  -- Copied from the document so policies don't need a join.
  site_id        uuid NOT NULL REFERENCES public.sites(id),
  rev            text NOT NULL,
  status         public.revision_status NOT NULL DEFAULT 'draft',
  change_summary text NOT NULL CHECK (length(trim(change_summary)) >= 5),
  body           text,
  file_name      text,
  file_mime      text,
  file_size      bigint,
  storage_path   text,
  prepared_by    uuid REFERENCES public.profiles(id),
  prepared_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_by    uuid REFERENCES public.profiles(id),
  reviewed_at    timestamptz,
  review_note    text,
  effective_at   timestamptz,
  superseded_at  timestamptz,
  UNIQUE (document_id, rev),
  -- Every revision carries its content: a file or written text.
  CHECK (storage_path IS NOT NULL OR length(coalesce(body, '')) >= 20),
  CHECK (storage_path IS NULL OR (file_name IS NOT NULL AND file_mime IS NOT NULL AND file_size > 0)),
  -- The person who wrote it never approves it.
  CHECK (reviewed_by IS NULL OR reviewed_by IS DISTINCT FROM prepared_by),
  CHECK (status IN ('draft', 'rejected') OR effective_at IS NOT NULL)
);

-- One current revision and at most one draft per document.
CREATE UNIQUE INDEX IF NOT EXISTS document_revisions_one_current ON public.document_revisions(document_id) WHERE status = 'current';
CREATE UNIQUE INDEX IF NOT EXISTS document_revisions_one_draft ON public.document_revisions(document_id) WHERE status = 'draft';

CREATE TABLE IF NOT EXISTS public.document_assets (
  document_id uuid NOT NULL REFERENCES public.documents(id),
  asset_id    uuid NOT NULL REFERENCES public.assets(id),
  site_id     uuid NOT NULL REFERENCES public.sites(id),
  added_by    uuid REFERENCES public.profiles(id),
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, asset_id)
);

CREATE TABLE IF NOT EXISTS public.wo_documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wo_id              uuid NOT NULL REFERENCES public.work_orders(id),
  document_id        uuid NOT NULL REFERENCES public.documents(id),
  source             public.wo_doc_source NOT NULL DEFAULT 'attached',
  -- Set when the work order closes: the revision kept with the record.
  pinned_revision_id uuid REFERENCES public.document_revisions(id),
  added_by           uuid REFERENCES public.profiles(id),
  added_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wo_id, document_id)
);

CREATE TABLE IF NOT EXISTS public.wo_document_views (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wo_id       uuid NOT NULL REFERENCES public.work_orders(id),
  document_id uuid NOT NULL REFERENCES public.documents(id),
  revision_id uuid NOT NULL REFERENCES public.document_revisions(id),
  stage       public.wo_stage NOT NULL,
  viewed_by   uuid REFERENCES public.profiles(id),
  viewed_at   timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION public.rev_label(p_index int) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE n int := p_index; out text := '';
BEGIN
  LOOP
    out := chr(65 + n % 26) || out;
    n := n / 26 - 1;
    EXIT WHEN n < 0;
  END LOOP;
  RETURN out;
END $$;

-- Document number: site code, type code, next four-digit sequence (CFD-DWG-0001).
CREATE OR REPLACE FUNCTION public.assign_doc_number() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prefix text; v_n int;
BEGIN
  IF NEW.doc_number IS NOT NULL AND public.current_user_role() IS NULL THEN
    RETURN NEW; -- service role seeding with fixed numbers
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('doc_number:' || NEW.site_id::text));
  SELECT code || '-' || CASE NEW.doc_type
           WHEN 'oem_manual' THEN 'OEM' WHEN 'drawing' THEN 'DWG' WHEN 'specification' THEN 'SPC'
           WHEN 'procedure' THEN 'PRC' ELSE 'MOC' END || '-'
    INTO v_prefix FROM public.sites WHERE id = NEW.site_id;
  SELECT coalesce(max(substr(doc_number, length(v_prefix) + 1)::int), 0) + 1 INTO v_n
    FROM public.documents WHERE site_id = NEW.site_id AND doc_number LIKE v_prefix || '%';
  NEW.doc_number := v_prefix || lpad(v_n::text, 4, '0');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS documents_assign_number ON public.documents;
CREATE TRIGGER documents_assign_number BEFORE INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.assign_doc_number();

-- Number, site and type never change; an obsolete document never comes back.
CREATE OR REPLACE FUNCTION public.guard_document() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.doc_number <> OLD.doc_number OR NEW.site_id <> OLD.site_id OR NEW.doc_type <> OLD.doc_type THEN
    RAISE EXCEPTION 'A document''s number, site and type never change';
  END IF;
  IF OLD.status = 'obsolete' AND NEW.status = 'active' THEN
    RAISE EXCEPTION 'An obsolete document stays archived; write a new document instead';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS documents_guard ON public.documents;
CREATE TRIGGER documents_guard BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_document();

-- New revisions: the next letter, the document's site, on an active document.
CREATE OR REPLACE FUNCTION public.prepare_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_doc public.documents%ROWTYPE; v_count int;
BEGIN
  SELECT * INTO v_doc FROM public.documents WHERE id = NEW.document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found'; END IF;
  NEW.site_id := v_doc.site_id;
  IF public.current_user_role() IS NULL AND NEW.rev IS NOT NULL THEN
    RETURN NEW; -- service role seeding history
  END IF;
  IF v_doc.status <> 'active' THEN RAISE EXCEPTION 'An obsolete document takes no new revisions'; END IF;
  SELECT count(*) INTO v_count FROM public.document_revisions WHERE document_id = NEW.document_id;
  NEW.rev := public.rev_label(v_count);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS document_revisions_prepare ON public.document_revisions;
CREATE TRIGGER document_revisions_prepare BEFORE INSERT ON public.document_revisions
  FOR EACH ROW EXECUTE FUNCTION public.prepare_revision();

-- A revision's content never changes. Status moves forward only:
-- draft → current or rejected, current → superseded.
CREATE OR REPLACE FUNCTION public.guard_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.document_id, NEW.site_id, NEW.rev, NEW.change_summary, NEW.body, NEW.file_name, NEW.file_mime, NEW.file_size,
      NEW.storage_path, NEW.prepared_by, NEW.prepared_at)
     IS DISTINCT FROM
     (OLD.document_id, OLD.site_id, OLD.rev, OLD.change_summary, OLD.body, OLD.file_name, OLD.file_mime, OLD.file_size,
      OLD.storage_path, OLD.prepared_by, OLD.prepared_at) THEN
    RAISE EXCEPTION 'A revision''s content never changes; write a new revision';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'draft' AND NEW.status IN ('current', 'rejected'))
    OR (OLD.status = 'current' AND NEW.status = 'superseded')) THEN
    RAISE EXCEPTION 'A revision can''t go from % to %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS document_revisions_guard ON public.document_revisions;
CREATE TRIGGER document_revisions_guard BEFORE UPDATE ON public.document_revisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_revision();

-- Asset links stay inside one site.
CREATE OR REPLACE FUNCTION public.check_document_asset() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT site_id INTO NEW.site_id FROM public.documents WHERE id = NEW.document_id;
  IF NOT EXISTS (SELECT 1 FROM public.assets WHERE id = NEW.asset_id AND site_id = NEW.site_id) THEN
    RAISE EXCEPTION 'The asset and the document must be at the same site';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS document_assets_check ON public.document_assets;
CREATE TRIGGER document_assets_check BEFORE INSERT ON public.document_assets
  FOR EACH ROW EXECUTE FUNCTION public.check_document_asset();

-- The revision kept with a work order: the one last opened from it, otherwise
-- the current one, otherwise the newest released one.
CREATE OR REPLACE FUNCTION public.revision_to_pin(p_wo_id uuid, p_document_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT revision_id FROM public.wo_document_views WHERE wo_id = p_wo_id AND document_id = p_document_id ORDER BY viewed_at DESC, id DESC LIMIT 1),
    (SELECT id FROM public.document_revisions WHERE document_id = p_document_id AND status = 'current'),
    (SELECT id FROM public.document_revisions WHERE document_id = p_document_id AND effective_at IS NOT NULL ORDER BY effective_at DESC LIMIT 1)
  );
$$;

-- When a work order closes (including closing as deferred), pin its documents.
CREATE OR REPLACE FUNCTION public.pin_wo_documents() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    UPDATE public.wo_documents SET pinned_revision_id = public.revision_to_pin(wo_id, document_id)
     WHERE wo_id = NEW.id AND pinned_revision_id IS NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS work_orders_pin_documents ON public.work_orders;
CREATE TRIGGER work_orders_pin_documents AFTER UPDATE OF status ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.pin_wo_documents();

-- A closed work order's documents are part of its record.
CREATE OR REPLACE FUNCTION public.guard_wo_document() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.work_orders WHERE id = OLD.wo_id AND status <> 'open') THEN
      RAISE EXCEPTION 'Closed work orders keep the documents they used';
    END IF;
    IF EXISTS (SELECT 1 FROM public.wo_document_views WHERE wo_id = OLD.wo_id AND document_id = OLD.document_id) THEN
      RAISE EXCEPTION 'Someone opened this document from the work order, so it stays with the record';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.pinned_revision_id IS NOT NULL AND NEW.pinned_revision_id IS DISTINCT FROM OLD.pinned_revision_id THEN
    RAISE EXCEPTION 'The revision kept with a closed work order never changes';
  END IF;
  IF (NEW.wo_id, NEW.document_id) IS DISTINCT FROM (OLD.wo_id, OLD.document_id) THEN
    RAISE EXCEPTION 'Detach the document and attach the other one';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS wo_documents_guard ON public.wo_documents;
CREATE TRIGGER wo_documents_guard BEFORE UPDATE OR DELETE ON public.wo_documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_wo_document();

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wo_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wo_document_views ENABLE ROW LEVEL SECURITY;

-- Read: everyone at the site, every document and revision, obsolete ones included.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['documents', 'document_revisions', 'document_assets'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s: site-scoped read" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "%s: site-scoped read" ON public.%I FOR SELECT USING (site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()))', t, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['wo_documents', 'wo_document_views'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s: site-scoped read" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "%s: site-scoped read" ON public.%I FOR SELECT USING (wo_id IN (SELECT id FROM public.work_orders WHERE site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())))',
      t, t);
  END LOOP;
END $$;

-- Authors (planner, supervisor, admin) create documents and write draft revisions as themselves.
DROP POLICY IF EXISTS "documents: authors create" ON public.documents;
CREATE POLICY "documents: authors create" ON public.documents
  FOR INSERT WITH CHECK (
    created_by = auth.uid() AND status = 'active'
    AND public.current_user_role() IN ('planner', 'supervisor', 'admin')
    AND site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "document_revisions: authors draft" ON public.document_revisions;
CREATE POLICY "document_revisions: authors draft" ON public.document_revisions
  FOR INSERT WITH CHECK (
    prepared_by = auth.uid() AND status = 'draft' AND reviewed_by IS NULL AND effective_at IS NULL
    AND public.current_user_role() IN ('planner', 'supervisor', 'admin')
    AND document_id IN (SELECT id FROM public.documents WHERE status = 'active' AND site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()))
  );
-- No update or delete policies on documents or revisions: review and obsolete go through the functions below.

DROP POLICY IF EXISTS "document_assets: authors link" ON public.document_assets;
CREATE POLICY "document_assets: authors link" ON public.document_assets
  FOR INSERT WITH CHECK (
    public.current_user_role() IN ('planner', 'supervisor', 'admin')
    AND document_id IN (SELECT id FROM public.documents WHERE site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()))
  );
DROP POLICY IF EXISTS "document_assets: authors unlink" ON public.document_assets;
CREATE POLICY "document_assets: authors unlink" ON public.document_assets
  FOR DELETE USING (
    public.current_user_role() IN ('planner', 'supervisor', 'admin')
    AND site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
  );

-- Attach an active document to an open work order at the same site.
DROP POLICY IF EXISTS "wo_documents: attach to open work" ON public.wo_documents;
CREATE POLICY "wo_documents: attach to open work" ON public.wo_documents
  FOR INSERT WITH CHECK (
    added_by = auth.uid() AND pinned_revision_id IS NULL AND source IN ('plan', 'attached')
    AND public.current_user_role() IN ('planner', 'supervisor', 'admin', 'technician')
    AND EXISTS (
      SELECT 1 FROM public.work_orders w JOIN public.documents d ON d.site_id = w.site_id
       WHERE w.id = wo_id AND d.id = document_id AND w.status = 'open' AND d.status = 'active'
         AND w.site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    )
  );
-- Detach (the guard trigger refuses once it has been opened or the work order closed).
DROP POLICY IF EXISTS "wo_documents: detach from open work" ON public.wo_documents;
CREATE POLICY "wo_documents: detach from open work" ON public.wo_documents
  FOR DELETE USING (
    public.current_user_role() IN ('planner', 'supervisor', 'admin')
    AND wo_id IN (SELECT id FROM public.work_orders WHERE status = 'open' AND site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()))
  );
-- Views are written only by open_wo_document().

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Approve (current; the old current is superseded) or reject a draft.
-- Supervisors and admins at the site, never on their own draft.
CREATE OR REPLACE FUNCTION public.review_document_revision(p_revision_id uuid, p_approve boolean, p_note text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rev public.document_revisions%ROWTYPE; v_doc public.documents%ROWTYPE;
BEGIN
  SELECT * INTO v_rev FROM public.document_revisions WHERE id = p_revision_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Revision not found'; END IF;
  IF v_rev.site_id NOT IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'No access to this site';
  END IF;
  IF public.current_user_role() NOT IN ('supervisor', 'admin') THEN
    RAISE EXCEPTION 'Revisions are approved by supervisors and admins';
  END IF;
  IF v_rev.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft can be reviewed'; END IF;
  IF v_rev.prepared_by = auth.uid() THEN
    RAISE EXCEPTION 'A revision is approved by someone other than the person who wrote it';
  END IF;
  SELECT * INTO v_doc FROM public.documents WHERE id = v_rev.document_id FOR UPDATE;
  IF v_doc.status <> 'active' THEN RAISE EXCEPTION 'The document is obsolete'; END IF;

  IF p_approve THEN
    UPDATE public.document_revisions SET status = 'superseded', superseded_at = now()
     WHERE document_id = v_rev.document_id AND status = 'current';
    UPDATE public.document_revisions
       SET status = 'current', effective_at = now(), reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
     WHERE id = p_revision_id;
  ELSE
    UPDATE public.document_revisions
       SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
     WHERE id = p_revision_id;
  END IF;
END $$;

-- Archive a document. Supervisors and admins. The replacement must be active at the same site.
CREATE OR REPLACE FUNCTION public.obsolete_document(p_document_id uuid, p_reason text, p_replaced_by uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_doc public.documents%ROWTYPE;
BEGIN
  SELECT * INTO v_doc FROM public.documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found'; END IF;
  IF v_doc.site_id NOT IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'No access to this site';
  END IF;
  IF public.current_user_role() NOT IN ('supervisor', 'admin') THEN
    RAISE EXCEPTION 'Documents are made obsolete by supervisors and admins';
  END IF;
  IF v_doc.status <> 'active' THEN RAISE EXCEPTION 'Already obsolete'; END IF;
  IF length(trim(coalesce(p_reason, ''))) < 5 THEN RAISE EXCEPTION 'Say why the document is obsolete'; END IF;
  IF p_replaced_by IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.documents WHERE id = p_replaced_by AND id <> p_document_id AND site_id = v_doc.site_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'The replacement must be another active document at this site';
  END IF;
  UPDATE public.documents
     SET status = 'obsolete', obsolete_reason = p_reason, replaced_by_id = p_replaced_by, obsoleted_by = auth.uid(), obsoleted_at = now()
   WHERE id = p_document_id;
  UPDATE public.document_revisions
     SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = 'Document made obsolete'
   WHERE document_id = p_document_id AND status = 'draft' AND prepared_by IS DISTINCT FROM auth.uid();
  -- Your own draft can't carry your review; mark it rejected without a reviewer.
  UPDATE public.document_revisions
     SET status = 'rejected', review_note = 'Document made obsolete'
   WHERE document_id = p_document_id AND status = 'draft';
END $$;

-- Open a document from a work order. Open work: log the view of the current
-- revision (adding the document to the work order if needed) and return it.
-- Closed work: return the revision kept with the work order.
CREATE OR REPLACE FUNCTION public.open_wo_document(p_wo_id uuid, p_document_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo public.work_orders%ROWTYPE; v_rev uuid; v_pinned uuid;
BEGIN
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_wo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order not found'; END IF;
  IF v_wo.site_id NOT IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'No access to this site';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.documents WHERE id = p_document_id AND site_id = v_wo.site_id) THEN
    RAISE EXCEPTION 'Document not found';
  END IF;
  SELECT id INTO v_rev FROM public.document_revisions WHERE document_id = p_document_id AND status = 'current';

  IF v_wo.status <> 'open' THEN
    SELECT pinned_revision_id INTO v_pinned FROM public.wo_documents WHERE wo_id = p_wo_id AND document_id = p_document_id;
    IF coalesce(v_pinned, v_rev) IS NULL THEN RAISE EXCEPTION 'No released revision'; END IF;
    RETURN coalesce(v_pinned, v_rev);
  END IF;

  IF v_rev IS NULL THEN RAISE EXCEPTION 'This document has no approved revision yet'; END IF;
  INSERT INTO public.wo_documents (wo_id, document_id, source, added_by)
  VALUES (p_wo_id, p_document_id, 'opened', auth.uid())
  ON CONFLICT (wo_id, document_id) DO NOTHING;
  INSERT INTO public.wo_document_views (wo_id, document_id, revision_id, stage, viewed_by)
  VALUES (p_wo_id, p_document_id, v_rev, v_wo.stage, auth.uid());
  RETURN v_rev;
END $$;

REVOKE ALL ON FUNCTION public.review_document_revision(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.obsolete_document(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.open_wo_document(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revision_to_pin(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_document_revision(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obsolete_document(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_wo_document(uuid, uuid) TO authenticated;

-- ============================================================
-- STORAGE: private bucket, one folder per site (path starts with the site id)
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false) ON CONFLICT (id) DO NOTHING;

    DROP POLICY IF EXISTS "documents bucket: site-scoped read" ON storage.objects;
    CREATE POLICY "documents bucket: site-scoped read" ON storage.objects
      FOR SELECT USING (
        bucket_id = 'documents'
        AND (storage.foldername(name))[1] IN (SELECT site_id::text FROM public.site_access WHERE user_id = auth.uid())
      );
    DROP POLICY IF EXISTS "documents bucket: authors upload" ON storage.objects;
    CREATE POLICY "documents bucket: authors upload" ON storage.objects
      FOR INSERT WITH CHECK (
        bucket_id = 'documents'
        AND public.current_user_role() IN ('planner', 'supervisor', 'admin')
        AND (storage.foldername(name))[1] IN (SELECT site_id::text FROM public.site_access WHERE user_id = auth.uid())
      );
    -- No update or delete: a revision's file never changes.
  END IF;
END $$;

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_documents_site ON public.documents(site_id, doc_number);
CREATE INDEX IF NOT EXISTS idx_document_revisions_doc ON public.document_revisions(document_id, prepared_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_assets_asset ON public.document_assets(asset_id);
CREATE INDEX IF NOT EXISTS idx_wo_documents_doc ON public.wo_documents(document_id);
CREATE INDEX IF NOT EXISTS idx_wo_document_views_wo ON public.wo_document_views(wo_id, document_id, viewed_at DESC);

-- ============================================================
-- ROLLBACK NOTES (manual — Supabase doesn't auto-rollback)
-- ============================================================
-- DROP TRIGGER IF EXISTS work_orders_pin_documents ON public.work_orders;
-- DROP FUNCTION IF EXISTS public.open_wo_document, public.obsolete_document, public.review_document_revision,
--   public.pin_wo_documents, public.revision_to_pin, public.guard_wo_document, public.check_document_asset,
--   public.guard_revision, public.prepare_revision, public.guard_document, public.assign_doc_number, public.rev_label;
-- DROP TABLE IF EXISTS public.wo_document_views, public.wo_documents, public.document_assets,
--   public.document_revisions, public.documents CASCADE;
-- DROP TYPE IF EXISTS public.wo_doc_source, public.revision_status, public.doc_status, public.doc_type;
-- DROP POLICY IF EXISTS "documents bucket: site-scoped read" ON storage.objects;
-- DROP POLICY IF EXISTS "documents bucket: authors upload" ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'documents';  -- only once the bucket is empty
