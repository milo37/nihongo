#!/bin/bash
# #694: one run of the guest data cleanup (studyGuestCleanupRuntime.js) from the
# deployed image: expired guest sessions and drafts, guest principals, replay
# records and rate-limit rows 7 days past their window. At most 1,000 rows per
# run; exit 1 = failed or rows left for the next run.
set -euo pipefail
cd /opt/harumaru
[[ -f .env ]] || { echo "no deployed release" >&2; exit 1; }

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
export GUEST_CLEANUP_ENVIRONMENT=PRODUCTION GUEST_CLEANUP_DRY_RUN=false
export GUEST_CLEANUP_CONFIRM=CLEANUP_EXPIRED_GUEST_DATA
exec docker compose run --rm --no-deps -T -e PRODUCTION_DATABASE_URL \
  -e GUEST_CLEANUP_ENVIRONMENT -e GUEST_CLEANUP_DRY_RUN -e GUEST_CLEANUP_CONFIRM \
  api sh -c 'GUEST_CLEANUP_DATABASE_URL="$DATABASE_URL" exec node api/dist/study/studyGuestCleanupRuntime.js'
