-- Member study goal (#1090, operator decision, 2026-11-17): one row per
-- member after the onboarding page. [Start] stores the daily goal (10 to
-- 150 questions, in tens) and when it was set; [Later] stores only when it
-- was skipped. No row means the page has not been answered yet. The target
-- level stays in "User"."targetLevel". No other object changes.
BEGIN;
SELECT pg_catalog.set_config('app.target_schema', pg_catalog.current_schema(), true);
SELECT pg_catalog.set_config('search_path', 'pg_catalog, pg_temp', true);
DO $preflight$
DECLARE
  target_schema NAME := pg_catalog.current_setting('app.target_schema', false)::NAME;
  expected_wrapper TEXT := CASE
    WHEN pg_catalog.current_database() ~ '_test$' THEN 'nihongo_test_migration_login'
    WHEN pg_catalog.current_database() ~ '_dev$' THEN 'nihongo_development_migration_login'
    WHEN pg_catalog.current_database() = 'nihongo' THEN 'nihongo_production_migration_login'
    ELSE NULL END;
BEGIN
  IF expected_wrapper IS NULL OR SESSION_USER <> expected_wrapper
    OR CURRENT_USER <> 'nihongo_migration'
    OR pg_catalog.current_setting('session_replication_role') <> 'origin'
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_namespace n
      JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
      WHERE n.nspname = target_schema AND r.rolname = 'nihongo_owner'
    ) THEN
    RAISE EXCEPTION 'Migration principal is not canonical.' USING ERRCODE = '42501';
  END IF;
END;
$preflight$;
SELECT pg_catalog.set_config('search_path',
  pg_catalog.quote_ident(pg_catalog.current_setting('app.target_schema', false)) ||
  ', pg_temp', true);
SET LOCAL check_function_bodies = false;
SET LOCAL ROLE "nihongo_owner";

CREATE TABLE "UserStudyGoal" (
    "userId" uuid NOT NULL,
    "dailyGoal" smallint,
    "goalSetAt" timestamp(3) with time zone,
    "onboardingSkippedAt" timestamp(3) with time zone,
    "createdAt" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT "UserStudyGoal_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "UserStudyGoal_userId_fkey" FOREIGN KEY ("userId")
      REFERENCES "User"(id) ON DELETE CASCADE,
    CONSTRAINT "UserStudyGoal_dailyGoal_check"
      CHECK ("dailyGoal" BETWEEN 10 AND 150 AND "dailyGoal" % 10 = 0),
    -- A goal comes with the time it was set; a row is either set or skipped.
    CONSTRAINT "UserStudyGoal_goal_set_check"
      CHECK (("dailyGoal" IS NULL) = ("goalSetAt" IS NULL)),
    CONSTRAINT "UserStudyGoal_answered_check"
      CHECK ("goalSetAt" IS NOT NULL OR "onboardingSkippedAt" IS NOT NULL)
);

GRANT SELECT ("userId", "dailyGoal", "goalSetAt", "onboardingSkippedAt"),
  INSERT ("userId", "dailyGoal", "goalSetAt", "onboardingSkippedAt"),
  UPDATE ("dailyGoal", "goalSetAt")
  ON TABLE "UserStudyGoal" TO nihongo_app;

SET LOCAL ROLE "nihongo_migration";
COMMIT;
