-- Phase 5 Slice 1: reserve the targeted-review idempotency operation.
-- PostgreSQL enum values are committed before any dependent object consumes them.
-- Existing migrations remain immutable.

BEGIN;

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum AS enum_value
    JOIN pg_type AS enum_type
      ON enum_type.oid = enum_value.enumtypid
    JOIN pg_namespace AS enum_namespace
      ON enum_namespace.oid = enum_type.typnamespace
    WHERE enum_namespace.nspname = current_schema()
      AND enum_type.typname = 'IdempotencyOperation'
      AND enum_value.enumlabel = 'STUDY_TARGETED_REVIEW_CREATE'
  )
    OR to_regclass('"UserMemo"') IS NOT NULL
    OR to_regclass('"ReviewEvent_wrongNoteId_occurredAt_id_idx"') IS NOT NULL
    OR to_regprocedure('normalize_user_memo_text(text)') IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_record
      WHERE constraint_record.conrelid = '"IdempotencyRecord"'::regclass
        AND constraint_record.conname = 'IdempotencyRecord_state_check'
        AND pg_get_constraintdef(constraint_record.oid) LIKE
          '%STUDY_TARGETED_REVIEW_CREATE%'
    )
    OR EXISTS (
      SELECT 1
      FROM pg_proc AS procedure_record
      JOIN pg_namespace AS procedure_namespace
        ON procedure_namespace.oid = procedure_record.pronamespace
      WHERE procedure_namespace.nspname = current_schema()
        AND procedure_record.proname IN (
          'validate_idempotency_record_change',
          'validate_idempotency_record_committed_state'
        )
        AND pg_get_functiondef(procedure_record.oid) LIKE
          '%STUDY_TARGETED_REVIEW_CREATE%'
    )
    OR (
      SELECT COUNT(*)
      FROM pg_trigger AS trigger_record
      JOIN pg_proc AS trigger_procedure
        ON trigger_procedure.oid = trigger_record.tgfoid
      JOIN pg_namespace AS trigger_procedure_namespace
        ON trigger_procedure_namespace.oid = trigger_procedure.pronamespace
      WHERE trigger_record.tgrelid = '"IdempotencyRecord"'::regclass
        AND NOT trigger_record.tgisinternal
        AND trigger_record.tgenabled = 'O'
        AND trigger_record.tgqual IS NULL
        AND trigger_record.tgattr = ''::int2vector
        AND trigger_record.tgnargs = 0
        AND trigger_procedure_namespace.nspname = current_schema()
        AND (
          (trigger_record.tgname = 'IdempotencyRecord_validate_change'
            AND trigger_procedure.proname =
              'validate_idempotency_record_change'
            AND trigger_record.tgtype = 31
            AND trigger_record.tgconstraint = 0
            AND NOT trigger_record.tgdeferrable
            AND NOT trigger_record.tginitdeferred)
          OR (trigger_record.tgname =
                'IdempotencyRecord_validate_committed_state'
            AND trigger_procedure.proname =
              'validate_idempotency_record_committed_state'
            AND trigger_record.tgtype = 21
            AND trigger_record.tgconstraint <> 0
            AND trigger_record.tgdeferrable
            AND trigger_record.tginitdeferred)
        )
    ) <> 2 THEN
    RAISE EXCEPTION
      'Phase 5 targeted-review enum migration requires zero partial objects.'
      USING ERRCODE = '23514';
  END IF;
END;
$block$;

ALTER TYPE "IdempotencyOperation"
  ADD VALUE 'STUDY_TARGETED_REVIEW_CREATE';

COMMIT;
