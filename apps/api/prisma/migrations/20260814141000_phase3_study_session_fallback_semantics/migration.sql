-- Phase 3 Slice 3 forward fix: content shortage reduces actualCount but does
-- not mean mode fallback. The retired enum label remains in PostgreSQL only
-- because applied enum values are not destructively rewritten.

BEGIN;

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "StudySession"
    WHERE "fallbackReason" = 'INSUFFICIENT_ELIGIBLE_QUESTIONS'
  ) THEN
    RAISE EXCEPTION 'Content shortage cannot be recorded as mode fallback.'
      USING ERRCODE = '23514';
  END IF;
END;
$block$;

ALTER TABLE "StudySession"
  ADD CONSTRAINT "StudySession_fallback_reason_contract_check" CHECK (
    "fallbackReason" IS NULL
    OR "fallbackReason" = 'INSUFFICIENT_MODE_CANDIDATES'
  );

COMMIT;
