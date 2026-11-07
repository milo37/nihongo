#!/bin/bash
# #57: one run of auth:erase-deletion-pending:compiled from the deployed image.
# Exit 0 = no unfinished work; 1 = failed, unavailable or truncated work
# (operations/runbooks/account-erasure.v2.md).
set -euo pipefail
cd /opt/harumaru
[[ -f .env ]] || { echo "no deployed release" >&2; exit 1; }

/opt/harumaru/bin/render-env.sh
# The SSM value is data: take the one expected line literally instead of
# `source`, so $(...) or `...` in it is never run by the shell.
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

# Values come from this shell's environment, so the URL never appears in argv.
# STAGING hosts also run a PRODUCTION-shaped database (DatabaseCapability), so
# both use PRODUCTION; the exact-target check still binds it to this host's URL.
export ACCOUNT_ERASURE_ENVIRONMENT=PRODUCTION
export ACCOUNT_ERASURE_CONFIRM=ERASE_DELETION_PENDING_ACCOUNTS
exec docker compose run --rm --no-deps -T \
  -e ACCOUNT_ERASURE_ENVIRONMENT -e ACCOUNT_ERASURE_CONFIRM -e PRODUCTION_DATABASE_URL \
  api node api/dist/auth/ssoAccountErasureCommand.js
