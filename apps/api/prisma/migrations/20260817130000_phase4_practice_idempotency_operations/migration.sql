-- Phase 4 Slice 1 enum-only migration. New enum values are committed before
-- any dependent table, trigger, or application path can reference them.

BEGIN;

ALTER TYPE "IdempotencyOperation"
  ADD VALUE 'STUDY_DRAFT_SAVE';

ALTER TYPE "IdempotencyOperation"
  ADD VALUE 'STUDY_RETRY_CREATE';

COMMIT;
