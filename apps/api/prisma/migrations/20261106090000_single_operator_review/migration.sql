-- JLP-704: a single operator may approve, and withdraw approval of, their own
-- question version. Only APPROVED and APPROVAL_WITHDRAWN drop the
-- actor <> author rule; CHANGES_REQUESTED keeps it.
-- Rollback: re-run the 20260827101000 definition of this constraint (it adds
-- "actorId" <> "counterpartActorId" back to both branches) after self-approved
-- rows are reviewed, since existing self-approvals would fail validation.
BEGIN;
SELECT pg_catalog.set_config('app.phase7_target_schema', pg_catalog.current_schema(), true);
SELECT pg_catalog.set_config('search_path', 'pg_catalog, pg_temp', true);
DO $preflight$
DECLARE
  target_schema NAME := pg_catalog.current_setting('app.phase7_target_schema', false)::NAME;
  expected_wrapper TEXT := CASE
    WHEN pg_catalog.current_database() ~ '_test$' THEN 'nihongo_test_phase7_migration_login'
    WHEN pg_catalog.current_database() ~ '_dev$' THEN 'nihongo_development_phase7_migration_login'
    ELSE NULL END;
BEGIN
  IF expected_wrapper IS NULL OR SESSION_USER <> expected_wrapper
    OR CURRENT_USER <> 'nihongo_phase7_migration'
    OR pg_catalog.current_setting('role', true) <> 'nihongo_phase7_migration'
    OR pg_catalog.current_setting('session_replication_role') <> 'origin'
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_namespace n
      JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
      WHERE n.nspname = target_schema AND r.rolname = 'nihongo_phase7_owner'
    ) THEN
    RAISE EXCEPTION 'Single-operator review migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

ALTER TABLE "ContentReview"
  DROP CONSTRAINT "ContentReview_action_check",
  ADD CONSTRAINT "ContentReview_action_check" CHECK (
    (
      "action" = 'REQUESTED'
      AND "fromState" IN ('DRAFT','CHANGES_REQUESTED')
      AND "toState" = 'IN_REVIEW'
      AND "actorKind" = 'ACCOUNT' AND "actorRole" = 'ADMIN'
      AND "counterpartActorId" IS NULL AND "reason" IS NULL
    ) OR (
      "action" = 'CHANGES_REQUESTED'
      AND "fromState" = 'IN_REVIEW' AND "toState" = 'CHANGES_REQUESTED'
      AND "actorKind" = 'ACCOUNT' AND "actorRole" = 'ADMIN'
      AND "counterpartActorId" IS NOT NULL AND "counterpartRole" = 'ADMIN'
      AND "actorId" <> "counterpartActorId" AND "reason" IS NOT NULL
    ) OR (
      "action" = 'APPROVED'
      AND "fromState" = 'IN_REVIEW' AND "toState" = 'APPROVED'
      AND "actorKind" = 'ACCOUNT' AND "actorRole" = 'ADMIN'
      AND "counterpartActorId" IS NOT NULL AND "counterpartRole" = 'ADMIN'
      AND "reason" IS NULL
    ) OR (
      "action" = 'APPROVAL_WITHDRAWN'
      AND "fromState" = 'APPROVED' AND "toState" = 'CHANGES_REQUESTED'
      AND "actorKind" = 'ACCOUNT' AND "actorRole" = 'ADMIN'
      AND "counterpartActorId" IS NOT NULL AND "counterpartRole" = 'ADMIN'
      AND "reason" IS NOT NULL
    ) OR (
      "action" = 'PUBLISHED'
      AND "fromState" = 'APPROVED' AND "toState" = 'PUBLISHED'
      AND "actorKind" = 'ACCOUNT' AND "actorRole" = 'ADMIN'
      AND "counterpartActorId" IS NOT NULL AND "counterpartRole" = 'ADMIN'
      AND "reason" IS NULL AND "comment" IS NULL
    ) OR (
      "action" = 'RETIRED'
      AND "fromState" = 'PUBLISHED' AND "toState" = 'RETIRED'
      AND "actorKind" = 'ACCOUNT' AND "actorRole" = 'ADMIN'
      AND "counterpartActorId" IS NULL
      AND "reason" IN ('PUBLISHED_REPLACEMENT','PUBLISHED_RETIREMENT','QUESTION_ARCHIVE')
      AND "comment" IS NULL
    ) OR (
      "action" = 'ARCHIVE_ABANDONED'
      AND "fromState" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')
      AND "toState" = 'RETIRED'
      AND "actorKind" = 'ACCOUNT' AND "actorRole" = 'ADMIN'
      AND "counterpartActorId" IS NOT NULL AND "counterpartRole" = 'ADMIN'
      AND "reason" = 'QUESTION_ARCHIVE' AND "comment" IS NULL
    ) OR (
      "action" = 'AUTHOR_ERASURE_ABANDONED'
      AND "fromState" IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')
      AND "toState" = 'RETIRED'
      AND "actorKind" = 'SYSTEM' AND "actorRole" = 'SYSTEM'
      AND "counterpartActorId" IS NOT NULL AND "counterpartRole" = 'ADMIN'
      AND "reason" = 'AUTHOR_ERASURE' AND "comment" IS NULL
    )
  );
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
