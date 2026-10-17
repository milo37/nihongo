-- Phase 3 Slice 5: owner-scoped WrongNote ordering and authoritative RANDOM
-- dashboard reads. Existing migrations remain immutable.
-- This transactional migration targets the pre-production rollout. A populated
-- production table requires an explicit maintenance window; CREATE INDEX
-- CONCURRENTLY requires a separate non-transactional runbook.

BEGIN;

DO $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "QuestionVersionTag"
    WHERE "labelSnapshot" <> btrim("labelSnapshot")
  ) THEN
    RAISE EXCEPTION
      'QuestionVersionTag labelSnapshot must use canonical ASCII-space edges.'
      USING ERRCODE = '23514';
  END IF;
END;
$function$;

ALTER TABLE "QuestionVersionTag"
  ADD CONSTRAINT "QuestionVersionTag_label_snapshot_trimmed_check"
  CHECK ("labelSnapshot" = btrim("labelSnapshot"));

CREATE INDEX "StudySession_userId_submittedAt_id_dashboard_idx"
  ON "StudySession"("userId", "submittedAt" DESC, "id")
  WHERE "userId" IS NOT NULL
    AND "status" = 'SUBMITTED'
    AND "submittedAt" IS NOT NULL
    AND "mode" = 'RANDOM';

CREATE INDEX "WrongNote_userId_wrongCount_lastWrongAt_id_idx"
  ON "WrongNote"(
    "userId",
    "wrongCount" DESC,
    "lastWrongAt" DESC,
    "id"
  );

COMMIT;
