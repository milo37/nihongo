#!/bin/bash
# #57: one run of auth:erase-deletion-pending:compiled from the deployed image.
# Exit 0 = no unfinished work; 1 = failed, unavailable or truncated work
# (operations/runbooks/account-erasure.v2.md). The command itself still refuses
# PRODUCTION until the backend injects a credentialed revoke adapter.
set -euo pipefail
source /etc/harumaru/public.env
cd /opt/harumaru
[[ -f .env ]] || { echo "no deployed release" >&2; exit 1; }

# The CLI accepts TEST, DEVELOPMENT or PRODUCTION only; a STAGING host has no
# valid erasure environment, so refuse before touching the database.
if [[ "$DEPLOYMENT_ENVIRONMENT" != "PRODUCTION" ]]; then
  echo "refusing: account erasure is not defined for DEPLOYMENT_ENVIRONMENT=$DEPLOYMENT_ENVIRONMENT" >&2
  exit 1
fi

/opt/harumaru/bin/render-env.sh
set -a
source /run/harumaru/erase.env
set +a
[[ -n "${PRODUCTION_DATABASE_URL:-}" ]] || { echo "missing SSM parameter PRODUCTION_DATABASE_URL" >&2; exit 1; }

# Values come from this shell's environment, so the URL never appears in argv.
export ACCOUNT_ERASURE_ENVIRONMENT=PRODUCTION
export ACCOUNT_ERASURE_CONFIRM=ERASE_DELETION_PENDING_ACCOUNTS
exec docker compose run --rm --no-deps -T \
  -e ACCOUNT_ERASURE_ENVIRONMENT -e ACCOUNT_ERASURE_CONFIRM -e PRODUCTION_DATABASE_URL \
  api node api/dist/auth/ssoAccountErasureCommand.js
