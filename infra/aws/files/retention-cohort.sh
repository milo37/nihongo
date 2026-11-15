#!/bin/bash
# #1042: one run of the daily return-rate count (retentionCohortCommand.js) from
# the deployed image. Exit 0 = counts written; 1 = failed or failedDays left.
# The SSM document carries these lines itself (no cloud-init file), so a change
# reaches running hosts with apply alone, without replacing user data.
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
export RETENTION_ENVIRONMENT=PRODUCTION RETENTION_CONFIRM=COUNT_RETENTION_COHORTS
exec docker compose run --rm --no-deps -T -e PRODUCTION_DATABASE_URL \
  -e RETENTION_ENVIRONMENT -e RETENTION_CONFIRM \
  api node api/dist/study/retentionCohortCommand.js
