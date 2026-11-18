#!/bin/bash
# shellcheck disable=SC2154 # job and dry_run come from the SSM document lines.
# #671: one run of a retention cleanup command from the deployed image. The SSM
# document puts the job and dry-run lines in front of these (parameters with
# allowed values only), so a change reaches running hosts with apply alone.
#   report-retention  closed report descriptions 180 days after closing (JLP-702)
#   study-drafts      expired study drafts and idempotency records (#699)
#   expired-sessions  sessions past their expiry (#695)
# Exit 0 = done; 1 = failed or rows left for the next run. dry-run counts only.
set -euo pipefail
cd /opt/harumaru
[[ -f .env ]] || { echo "no deployed release" >&2; exit 1; }
case "$dry_run" in true | false) ;; *) echo "dry run must be true or false" >&2; exit 1 ;; esac

case "$job" in
  report-retention)
    prefix=USER_REPORT_RETENTION confirm=REDACT_EXPIRED_USER_REPORTS
    command=api/dist/report/userReportRetentionCommand.js ;;
  study-drafts)
    prefix=STUDY_DRAFT_CLEANUP confirm=DELETE_EXPIRED_STUDY_DRAFTS
    command=api/dist/study/studyDraftCleanupCommand.js ;;
  expired-sessions)
    prefix=EXPIRED_SESSION_CLEANUP confirm=DELETE_EXPIRED_SESSIONS
    command=api/dist/auth/sessionRetentionCommand.js ;;
  *) echo "unknown job" >&2; exit 1 ;;
esac

/opt/harumaru/bin/render-env.sh
# The exact-target guard compares the app URL with PRODUCTION_DATABASE_URL (SSM);
# take that one line literally instead of `source`.
PRODUCTION_DATABASE_URL=''
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    '') ;;
    PRODUCTION_DATABASE_URL=*) PRODUCTION_DATABASE_URL="${line#PRODUCTION_DATABASE_URL=}" ;;
    *) echo "unexpected line in erase.env" >&2; exit 1 ;;
  esac
done < /run/harumaru/erase.env
export PRODUCTION_DATABASE_URL
[[ -n "${PRODUCTION_DATABASE_URL:-}" ]] || { echo "missing SSM parameter PRODUCTION_DATABASE_URL" >&2; exit 1; }

# Runs as nihongo_app with the API's own login (DATABASE_URL from api.env).
# STAGING hosts also run a PRODUCTION-shaped database (DatabaseCapability).
export "${prefix}_CONFIRM=$confirm" "${prefix}_DRY_RUN=$dry_run"
exec docker compose run --rm --no-deps -T -e PRODUCTION_DATABASE_URL \
  -e "${prefix}_CONFIRM" -e "${prefix}_DRY_RUN" api node "$command"
