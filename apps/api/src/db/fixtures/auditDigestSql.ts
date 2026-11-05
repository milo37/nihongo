import type { QueryResultRow } from 'pg'

/**
 * Test-only SQL audit digest (#504 P7 PR5b).
 *
 * phase7_admin_audit_content_digest with its JCS helpers moved out of the
 * schema: no database code calls it since the API computes the audit digest.
 * Tests still check the API digest against this independent SQL canonical
 * form, unchanged from 20260827101000_phase7_admin_cms_foundation, created in
 * the connection's pg_temp and called as pg_temp."phase7_admin_audit_content_digest".
 */
const AUDIT_DIGEST_SQL = `
CREATE OR REPLACE FUNCTION pg_temp."phase7_jcs_string_array"(value JSONB)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
  SELECT '[' || COALESCE(string_agg(to_jsonb(item)::TEXT, ',' ORDER BY ordinal), '') || ']'
  FROM jsonb_array_elements_text(value) WITH ORDINALITY AS element(item, ordinal);
$function$;

CREATE OR REPLACE FUNCTION pg_temp."phase7_jcs_audit_metadata"(value JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
DECLARE
  kind TEXT := value->>'kind';
BEGIN
  CASE kind
    WHEN 'NONE_V1' THEN
      RETURN '{"kind":"NONE_V1"}';
    WHEN 'REVIEW_REQUEST_BATCH_V1' THEN
      RETURN '{"itemCount":' || (value->>'itemCount')
        || ',"kind":"REVIEW_REQUEST_BATCH_V1"}';
    WHEN 'IMPORT_APPLY_V1' THEN
      RETURN '{"itemCount":' || (value->>'itemCount')
        || ',"kind":"IMPORT_APPLY_V1","mappingDigest":'
        || to_jsonb(value->>'mappingDigest')::TEXT
        || ',"validationDigest":'
        || to_jsonb(value->>'validationDigest')::TEXT || '}';
    WHEN 'EXPORT_V1' THEN
      RETURN '{"kind":"EXPORT_V1","questionCount":'
        || (value->>'questionCount') || ',"responseBodyDigest":'
        || to_jsonb(value->>'responseBodyDigest')::TEXT
        || ',"selectionDigest":'
        || to_jsonb(value->>'selectionDigest')::TEXT
        || ',"versionCount":' || (value->>'versionCount') || '}';
    WHEN 'REAUTHENTICATION_V1' THEN
      RETURN '{"kind":"REAUTHENTICATION_V1","rotation":'
        || to_jsonb(value->>'rotation')::TEXT || '}';
    WHEN 'QUESTION_ARCHIVE_V1' THEN
      RETURN '{"abandonedCandidateCount":'
        || (value->>'abandonedCandidateCount')
        || ',"kind":"QUESTION_ARCHIVE_V1","retiredPublishedCount":'
        || (value->>'retiredPublishedCount') || '}';
    WHEN 'AUTHOR_ERASURE_V1' THEN
      RETURN '{"abandonedCount":' || (value->>'abandonedCount')
        || ',"kind":"AUTHOR_ERASURE_V1","subjectActorDigest":'
        || to_jsonb(value->>'subjectActorDigest')::TEXT || '}';
  END CASE;
  RAISE EXCEPTION 'Unsupported audit metadata kind.' USING ERRCODE = '23514';
END;
$function$;

CREATE OR REPLACE FUNCTION pg_temp."phase7_admin_audit_content_digest"(
  operation_id UUID,
  command_value "AdminAuditCommand",
  target_type_value "AdminAuditTargetType",
  target_id_value UUID,
  before_state_value TEXT,
  after_state_value TEXT,
  before_row_version_value INTEGER,
  after_row_version_value INTEGER,
  changed_fields_value JSONB,
  metadata_value JSONB
)
RETURNS VARCHAR(64)
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT encode(public.digest(convert_to(
    '{"afterRowVersion":' || COALESCE(after_row_version_value::TEXT, 'null')
    || ',"afterState":' || COALESCE(to_jsonb(after_state_value)::TEXT, 'null')
    || ',"beforeRowVersion":' || COALESCE(before_row_version_value::TEXT, 'null')
    || ',"beforeState":' || COALESCE(to_jsonb(before_state_value)::TEXT, 'null')
    || ',"changedFields":' || pg_temp."phase7_jcs_string_array"(changed_fields_value)
    || ',"command":' || to_jsonb(command_value::TEXT)::TEXT
    || ',"metadata":' || pg_temp."phase7_jcs_audit_metadata"(metadata_value)
    || ',"operationId":' || to_jsonb(operation_id::TEXT)::TEXT
    || ',"targetId":' || to_jsonb(target_id_value::TEXT)::TEXT
    || ',"targetType":' || to_jsonb(target_type_value::TEXT)::TEXT || '}',
    'UTF8'
  ), 'sha256'::TEXT), 'hex');
$function$;
`

interface PgQueryable {
  query: <Row extends QueryResultRow = QueryResultRow>(
    sql: string
  ) => Promise<{ rows: Row[] }>
}

export const installAuditDigestSql = async (
  client: PgQueryable
): Promise<void> => {
  await client.query(AUDIT_DIGEST_SQL)
}
