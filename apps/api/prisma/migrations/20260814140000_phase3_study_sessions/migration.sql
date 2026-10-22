-- Phase 3 Slice 3: owner-scoped study sessions with immutable ordered
-- QuestionVersion pins. Submission facts remain a later slice.

BEGIN;

CREATE TYPE "StudyMode" AS ENUM (
  'RANDOM',
  'WRONG_NOTE',
  'WEAKNESS',
  'BOOKMARK',
  'DAILY_REVIEW'
);
CREATE TYPE "StudySessionStatus" AS ENUM (
  'IN_PROGRESS',
  'SUBMITTED',
  'EXPIRED',
  'CANCELLED'
);
CREATE TYPE "StudySessionFallbackReason" AS ENUM (
  'INSUFFICIENT_ELIGIBLE_QUESTIONS',
  'INSUFFICIENT_MODE_CANDIDATES'
);

CREATE TABLE "StudySession" (
  "id" UUID NOT NULL,
  "userId" UUID,
  "guestPrincipalId" UUID,
  "level" "JlptLevel" NOT NULL,
  "subject" "QuestionSubject" NOT NULL,
  "mode" "StudyMode" NOT NULL,
  "status" "StudySessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "requestedCount" INTEGER NOT NULL,
  "actualCount" INTEGER NOT NULL,
  "usedFallback" BOOLEAN NOT NULL DEFAULT false,
  "fallbackReason" "StudySessionFallbackReason",
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "submittedAt" TIMESTAMPTZ(3),
  "cancelledAt" TIMESTAMPTZ(3),
  "durationSec" INTEGER,
  "submissionHash" VARCHAR(64),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "StudySession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudySession_owner_xor_check" CHECK (
    ("userId" IS NULL) <> ("guestPrincipalId" IS NULL)
  ),
  CONSTRAINT "StudySession_count_check" CHECK (
    "requestedCount" BETWEEN 1 AND 20
    AND "actualCount" BETWEEN 1 AND "requestedCount"
  ),
  CONSTRAINT "StudySession_fallback_check" CHECK (
    "usedFallback" = ("fallbackReason" IS NOT NULL)
  ),
  CONSTRAINT "StudySession_expiry_check" CHECK ("expiresAt" > "startedAt"),
  CONSTRAINT "StudySession_duration_check" CHECK (
    "durationSec" IS NULL OR "durationSec" >= 0
  ),
  CONSTRAINT "StudySession_submission_hash_check" CHECK (
    "submissionHash" IS NULL OR "submissionHash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "StudySession_state_check" CHECK (
    ("status" = 'IN_PROGRESS'
      AND "submittedAt" IS NULL
      AND "cancelledAt" IS NULL
      AND "durationSec" IS NULL
      AND "submissionHash" IS NULL)
    OR ("status" = 'SUBMITTED'
      AND "submittedAt" IS NOT NULL
      AND "cancelledAt" IS NULL
      AND "durationSec" IS NOT NULL
      AND "submissionHash" IS NOT NULL)
    OR ("status" = 'EXPIRED'
      AND "submittedAt" IS NULL
      AND "cancelledAt" IS NULL
      AND "durationSec" IS NULL
      AND "submissionHash" IS NULL)
    OR ("status" = 'CANCELLED'
      AND "submittedAt" IS NULL
      AND "cancelledAt" IS NOT NULL
      AND "durationSec" IS NULL
      AND "submissionHash" IS NULL)
  )
);

CREATE TABLE "StudySessionQuestion" (
  "id" UUID NOT NULL,
  "studySessionId" UUID NOT NULL,
  "questionId" UUID NOT NULL,
  "questionVersionId" UUID NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudySessionQuestion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudySessionQuestion_ordinal_check" CHECK ("ordinal" > 0)
);

CREATE INDEX "StudySession_userId_status_startedAt_idx"
  ON "StudySession"("userId", "status", "startedAt" DESC);
CREATE INDEX "StudySession_guestPrincipalId_status_expiresAt_idx"
  ON "StudySession"("guestPrincipalId", "status", "expiresAt");
CREATE INDEX "StudySession_status_expiresAt_idx"
  ON "StudySession"("status", "expiresAt");
CREATE UNIQUE INDEX "StudySessionQuestion_studySessionId_ordinal_key"
  ON "StudySessionQuestion"("studySessionId", "ordinal");
CREATE UNIQUE INDEX "StudySessionQuestion_studySessionId_questionId_key"
  ON "StudySessionQuestion"("studySessionId", "questionId");
CREATE UNIQUE INDEX "StudySessionQuestion_studySessionId_questionVersionId_key"
  ON "StudySessionQuestion"("studySessionId", "questionVersionId");
CREATE UNIQUE INDEX "StudySessionQuestion_id_questionVersionId_key"
  ON "StudySessionQuestion"("id", "questionVersionId");
CREATE INDEX "StudySessionQuestion_questionId_questionVersionId_idx"
  ON "StudySessionQuestion"("questionId", "questionVersionId");

ALTER TABLE "StudySession"
  ADD CONSTRAINT "StudySession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudySession"
  ADD CONSTRAINT "StudySession_guestPrincipalId_fkey"
  FOREIGN KEY ("guestPrincipalId") REFERENCES "GuestPrincipal"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudySessionQuestion"
  ADD CONSTRAINT "StudySessionQuestion_studySessionId_fkey"
  FOREIGN KEY ("studySessionId") REFERENCES "StudySession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudySessionQuestion"
  ADD CONSTRAINT "StudySessionQuestion_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "Question"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudySessionQuestion"
  ADD CONSTRAINT "StudySessionQuestion_questionId_questionVersionId_fkey"
  FOREIGN KEY ("questionId", "questionVersionId")
  REFERENCES "QuestionVersion"("questionId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "validate_study_session_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."status" <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'StudySession must be inserted IN_PROGRESS.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."guestPrincipalId" IS DISTINCT FROM OLD."guestPrincipalId"
    OR NEW."level" IS DISTINCT FROM OLD."level"
    OR NEW."subject" IS DISTINCT FROM OLD."subject"
    OR NEW."mode" IS DISTINCT FROM OLD."mode"
    OR NEW."requestedCount" IS DISTINCT FROM OLD."requestedCount"
    OR NEW."actualCount" IS DISTINCT FROM OLD."actualCount"
    OR NEW."usedFallback" IS DISTINCT FROM OLD."usedFallback"
    OR NEW."fallbackReason" IS DISTINCT FROM OLD."fallbackReason"
    OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt"
    OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
  ) THEN
    RAISE EXCEPTION 'StudySession selection metadata is immutable.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."status" <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Terminal StudySession is immutable.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW."status" NOT IN ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Invalid StudySession state transition.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER "StudySession_validate_change"
BEFORE INSERT OR UPDATE ON "StudySession"
FOR EACH ROW EXECUTE FUNCTION "validate_study_session_change"();

CREATE FUNCTION "validate_study_session_question_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  parent_status "StudySessionStatus";
  parent_actual_count INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "status", "actualCount"
    INTO parent_status, parent_actual_count
    FROM "StudySession"
    WHERE "id" = NEW."studySessionId"
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN NEW;
    END IF;
    IF parent_status <> 'IN_PROGRESS'
      OR NEW."ordinal" NOT BETWEEN 1 AND parent_actual_count THEN
      RAISE EXCEPTION 'StudySessionQuestion cannot change a sealed selection.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM 1 FROM "StudySession" WHERE "id" = OLD."studySessionId";
    IF NOT FOUND THEN
      RETURN OLD;
    END IF;
  END IF;

  RAISE EXCEPTION 'StudySessionQuestion is immutable.'
    USING ERRCODE = '23514';
END;
$function$;

CREATE TRIGGER "StudySessionQuestion_validate_change"
BEFORE INSERT OR UPDATE OR DELETE ON "StudySessionQuestion"
FOR EACH ROW EXECUTE FUNCTION "validate_study_session_question_change"();

CREATE FUNCTION "validate_study_session_selection_complete"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  selected_count INTEGER;
  minimum_ordinal INTEGER;
  maximum_ordinal INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "StudySession" WHERE "id" = NEW."id") THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*), MIN("ordinal"), MAX("ordinal")
  INTO selected_count, minimum_ordinal, maximum_ordinal
  FROM "StudySessionQuestion"
  WHERE "studySessionId" = NEW."id";

  IF selected_count <> NEW."actualCount"
    OR minimum_ordinal <> 1
    OR maximum_ordinal <> NEW."actualCount" THEN
    RAISE EXCEPTION 'StudySession selection must be complete and contiguous.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER "StudySession_validate_selection_complete"
AFTER INSERT ON "StudySession"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_study_session_selection_complete"();

COMMIT;
