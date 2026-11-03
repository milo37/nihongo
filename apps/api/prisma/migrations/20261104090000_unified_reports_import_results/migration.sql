-- #491 additive: unified learner reports and stored question import results.
-- New tables only; no existing table, constraint, trigger or grant changes.
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
    RAISE EXCEPTION 'Report migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

-- RECEIVED -> ANSWERED (replied and closed) | CLOSED (closed without reply).
CREATE TABLE "UserReport" (
  "id" UUID PRIMARY KEY DEFAULT public.gen_random_uuid(),
  "kind" VARCHAR(16) NOT NULL CHECK ("kind" IN ('QUESTION', 'APP_ERROR')),
  "status" VARCHAR(16) NOT NULL DEFAULT 'RECEIVED'
    CHECK ("status" IN ('RECEIVED', 'ANSWERED', 'CLOSED')),
  "location" VARCHAR(200) NOT NULL CHECK (char_length("location") BETWEEN 1 AND 200),
  "questionId" UUID,
  "questionVersionId" UUID,
  "description" TEXT NOT NULL CHECK (char_length("description") BETWEEN 1 AND 1000),
  "reporterUserId" UUID REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  "reporterReply" TEXT CHECK (char_length("reporterReply") BETWEEN 1 AND 1000),
  "repliedAt" TIMESTAMPTZ(3),
  "internalNote" TEXT CHECK (char_length("internalNote") BETWEEN 1 AND 1000),
  "closedAt" TIMESTAMPTZ(3),
  "rowVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("rowVersion" >= 1),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "UserReport_question_version_fkey"
    FOREIGN KEY ("questionId", "questionVersionId")
    REFERENCES "QuestionVersion"("questionId", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "UserReport_kind_target_check" CHECK (
    ("kind" = 'QUESTION') = ("questionId" IS NOT NULL)
    AND ("questionId" IS NULL) = ("questionVersionId" IS NULL)
  ),
  CONSTRAINT "UserReport_status_fields_check" CHECK (
    ("status" = 'RECEIVED' AND "reporterReply" IS NULL AND "repliedAt" IS NULL
      AND "closedAt" IS NULL)
    OR ("status" = 'ANSWERED' AND "reporterReply" IS NOT NULL
      AND "repliedAt" IS NOT NULL AND "closedAt" = "repliedAt")
    OR ("status" = 'CLOSED' AND "reporterReply" IS NULL AND "repliedAt" IS NULL
      AND "closedAt" IS NOT NULL)
  )
);
-- Admin list: RECEIVED first, then newest.
CREATE INDEX "UserReport_admin_order_idx" ON "UserReport"(
  (("status" = 'RECEIVED')) DESC, "createdAt" DESC, "id" DESC);
CREATE INDEX "UserReport_reporter_idx" ON "UserReport"(
  "reporterUserId", "createdAt" DESC, "id" DESC);
-- One open question report per learner and question version.
CREATE UNIQUE INDEX "UserReport_open_question_report_key" ON "UserReport"(
  "reporterUserId", "questionVersionId")
  WHERE "kind" = 'QUESTION' AND "status" = 'RECEIVED';

-- Same importId + same request digest replays the stored apply response.
CREATE TABLE "QuestionImportResult" (
  "importId" UUID PRIMARY KEY,
  "actorUserId" UUID NOT NULL,
  "requestDigest" VARCHAR(64) NOT NULL CHECK ("requestDigest" ~ '^[0-9a-f]{64}$'),
  "response" JSONB NOT NULL CHECK (pg_catalog.jsonb_typeof("response") = 'object'),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX "QuestionImportResult_createdAt_idx" ON "QuestionImportResult"("createdAt");

REVOKE ALL ON TABLE "UserReport", "QuestionImportResult" FROM PUBLIC,
  "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker";
GRANT SELECT, INSERT, UPDATE ON TABLE "UserReport" TO "nihongo_app";
GRANT SELECT, INSERT ON TABLE "QuestionImportResult" TO "nihongo_app";
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
