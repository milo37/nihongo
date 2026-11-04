-- JLP-701 (#504 P1): study, review, wrong-note and idempotency rules live in
-- the API services. Drop the trigger guards on those tables and their trigger
-- functions. Tables, keys, indexes and CHECK constraints stay.
-- Rollback: re-run the CREATE FUNCTION / CREATE TRIGGER statements from the
-- migrations that last defined them (20260814140000 through 20261030100000).
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
    RAISE EXCEPTION 'Study trigger removal migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.phase7_target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL ROLE "nihongo_phase7_owner";

DROP TRIGGER "IdempotencyRecord_validate_change" ON "IdempotencyRecord";
DROP TRIGGER "IdempotencyRecord_validate_committed_state" ON "IdempotencyRecord";
DROP TRIGGER "ReviewEvent_validate_change" ON "ReviewEvent";
DROP TRIGGER "ReviewEvent_validate_latest_wrong_snapshot" ON "ReviewEvent";
DROP TRIGGER "ReviewEvent_validate_submission_snapshot" ON "ReviewEvent";
DROP TRIGGER "ReviewEvent_validate_wrong_note_snapshot" ON "ReviewEvent";
DROP TRIGGER "ReviewSchedule_validate_change" ON "ReviewSchedule";
DROP TRIGGER "ReviewSchedule_validate_snapshot" ON "ReviewSchedule";
DROP TRIGGER "StudyAnswer_validate_change" ON "StudyAnswer";
DROP TRIGGER "StudyAnswer_validate_submission_snapshot" ON "StudyAnswer";
DROP TRIGGER "StudyDraft_validate_aggregate" ON "StudyDraft";
DROP TRIGGER "StudyDraft_validate_change" ON "StudyDraft";
DROP TRIGGER "StudyDraftAnswer_validate_aggregate" ON "StudyDraftAnswer";
DROP TRIGGER "StudyDraftAnswer_validate_change" ON "StudyDraftAnswer";
DROP TRIGGER "StudyResult_validate_change" ON "StudyResult";
DROP TRIGGER "StudyResult_validate_submission_snapshot" ON "StudyResult";
DROP TRIGGER "StudySession_protect_created_at" ON "StudySession";
DROP TRIGGER "StudySession_protect_submitted_user_delete" ON "StudySession";
DROP TRIGGER "StudySession_validate_change" ON "StudySession";
DROP TRIGGER "StudySession_validate_draft_aggregate" ON "StudySession";
DROP TRIGGER "StudySession_validate_retry_relation" ON "StudySession";
DROP TRIGGER "StudySession_validate_selection_complete" ON "StudySession";
DROP TRIGGER "StudySession_validate_submission_snapshot" ON "StudySession";
DROP TRIGGER "StudySessionQuestion_validate_change" ON "StudySessionQuestion";
DROP TRIGGER "StudySessionQuestion_validate_draft_aggregate" ON "StudySessionQuestion";
DROP TRIGGER "WrongNote_validate_change" ON "WrongNote";
DROP TRIGGER "WrongNote_validate_latest_wrong_snapshot" ON "WrongNote";
DROP TRIGGER "WrongNote_validate_snapshot" ON "WrongNote";

DROP FUNCTION "protect_study_session_created_at"();
DROP FUNCTION "protect_submitted_user_study_session_delete"();
DROP FUNCTION "validate_idempotency_record_change"();
DROP FUNCTION "validate_idempotency_record_committed_state"();
DROP FUNCTION "validate_review_event_change"();
DROP FUNCTION "validate_review_schedule_change"();
DROP FUNCTION "validate_study_answer_change"();
DROP FUNCTION "validate_study_draft_aggregate"();
DROP FUNCTION "validate_study_draft_answer_change"();
DROP FUNCTION "validate_study_draft_change"();
DROP FUNCTION "validate_study_result_change"();
DROP FUNCTION "validate_study_retry_relation"();
DROP FUNCTION "validate_study_session_change"();
DROP FUNCTION "validate_study_session_question_change"();
DROP FUNCTION "validate_study_session_selection_complete"();
DROP FUNCTION "validate_study_submission_snapshot"();
DROP FUNCTION "validate_wrong_note_change"();
DROP FUNCTION "validate_wrong_note_latest_wrong_snapshot"();
DROP FUNCTION "validate_wrong_note_snapshot"();
SET LOCAL ROLE "nihongo_phase7_migration";
COMMIT;
