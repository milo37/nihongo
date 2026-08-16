-- Phase 3 Slice 4 follow-up: a materialized WrongNote must retain the exact
-- question version and timestamp of its latest incorrect ReviewEvent.

BEGIN;

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "WrongNote" AS note
    LEFT JOIN LATERAL (
      SELECT event."previousStatus", event."occurredAt"
      FROM "ReviewEvent" AS event
      WHERE event."wrongNoteId" = note."id"
      ORDER BY event."occurredAt", event."id"
      LIMIT 1
    ) AS first_event ON TRUE
    LEFT JOIN LATERAL (
      SELECT event."questionVersionId", event."occurredAt"
      FROM "ReviewEvent" AS event
      WHERE event."wrongNoteId" = note."id"
        AND event."isCorrect" = false
      ORDER BY event."occurredAt" DESC, event."id" DESC
      LIMIT 1
    ) AS latest_incorrect ON TRUE
    WHERE note."currentReviewQuestionVersionId" IS NOT NULL
      OR note."createdAt" > note."updatedAt"
      OR first_event."occurredAt" IS NULL
      OR first_event."previousStatus" IS NOT NULL
      OR note."createdAt" IS DISTINCT FROM first_event."occurredAt"
      OR latest_incorrect."occurredAt" IS NULL
      OR note."lastWrongAt" IS DISTINCT FROM latest_incorrect."occurredAt"
      OR note."lastWrongQuestionVersionId" IS DISTINCT FROM
        latest_incorrect."questionVersionId"
  ) THEN
    RAISE EXCEPTION 'Existing WrongNote does not match its latest incorrect ReviewEvent.'
      USING ERRCODE = '23514';
  END IF;
END;
$block$;

ALTER TABLE "WrongNote"
  ADD CONSTRAINT "WrongNote_slice4_current_review_check" CHECK (
    "currentReviewQuestionVersionId" IS NULL
  ),
  ADD CONSTRAINT "WrongNote_created_updated_check" CHECK (
    "createdAt" <= "updatedAt"
  );

CREATE FUNCTION "validate_wrong_note_latest_wrong_snapshot"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  target_wrong_note_id UUID;
  note_last_wrong_at TIMESTAMPTZ(3);
  note_last_wrong_version_id UUID;
  note_created_at TIMESTAMPTZ(3);
  first_event_at TIMESTAMPTZ(3);
  first_previous_status "WrongNoteStatus";
  latest_wrong_at TIMESTAMPTZ(3);
  latest_wrong_version_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'WrongNote' THEN
    target_wrong_note_id := CASE
      WHEN TG_OP = 'DELETE' THEN OLD."id"
      ELSE NEW."id"
    END;
  ELSE
    target_wrong_note_id := CASE
      WHEN TG_OP = 'DELETE' THEN OLD."wrongNoteId"
      ELSE NEW."wrongNoteId"
    END;
  END IF;

  SELECT
    note."lastWrongAt",
    note."lastWrongQuestionVersionId",
    note."createdAt"
  INTO note_last_wrong_at, note_last_wrong_version_id, note_created_at
  FROM "WrongNote" AS note
  WHERE note."id" = target_wrong_note_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT event."occurredAt", event."previousStatus"
  INTO first_event_at, first_previous_status
  FROM "ReviewEvent" AS event
  WHERE event."wrongNoteId" = target_wrong_note_id
  ORDER BY event."occurredAt", event."id"
  LIMIT 1;

  IF NOT FOUND
    OR first_previous_status IS NOT NULL
    OR note_created_at IS DISTINCT FROM first_event_at THEN
    RAISE EXCEPTION 'WrongNote createdAt must match its first ReviewEvent.'
      USING ERRCODE = '23514';
  END IF;

  SELECT event."occurredAt", event."questionVersionId"
  INTO latest_wrong_at, latest_wrong_version_id
  FROM "ReviewEvent" AS event
  WHERE event."wrongNoteId" = target_wrong_note_id
    AND event."isCorrect" = false
  ORDER BY event."occurredAt" DESC, event."id" DESC
  LIMIT 1;

  IF NOT FOUND
    OR note_last_wrong_at IS DISTINCT FROM latest_wrong_at
    OR note_last_wrong_version_id IS DISTINCT FROM latest_wrong_version_id THEN
    RAISE EXCEPTION 'WrongNote must match its latest incorrect ReviewEvent.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER "WrongNote_validate_latest_wrong_snapshot"
AFTER INSERT OR UPDATE ON "WrongNote"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_wrong_note_latest_wrong_snapshot"();

CREATE CONSTRAINT TRIGGER "ReviewEvent_validate_latest_wrong_snapshot"
AFTER INSERT ON "ReviewEvent"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_wrong_note_latest_wrong_snapshot"();

COMMIT;
