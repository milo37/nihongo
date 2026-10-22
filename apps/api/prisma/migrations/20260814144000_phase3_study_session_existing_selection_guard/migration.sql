-- Phase 3 Slice 3: reject any aggregate that could have been left incomplete
-- before StudySession identity immutability was introduced.

BEGIN;

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "StudySession" AS session
    LEFT JOIN "StudySessionQuestion" AS item
      ON item."studySessionId" = session."id"
    GROUP BY session."id", session."actualCount"
    HAVING COUNT(item."id") <> session."actualCount"
      OR MIN(item."ordinal") <> 1
      OR MAX(item."ordinal") <> session."actualCount"
  ) THEN
    RAISE EXCEPTION 'Existing StudySession selection is incomplete or non-contiguous.'
      USING ERRCODE = '23514';
  END IF;
END;
$block$;

COMMIT;
