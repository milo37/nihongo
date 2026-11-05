#!/bin/bash
# #57: one run of auth:erase-deletion-pending:compiled from the deployed image.
# Exit 0 = no unfinished work; 1 = failed, unavailable or truncated work
# (operations/runbooks/account-erasure.v2.md). PRODUCTION is refused by the
# command itself until the backend injects a credentialed revoke adapter.
set -euo pipefail
cd /opt/harumaru
[[ -f .env ]] || { echo "no deployed release" >&2; exit 1; }
/opt/harumaru/bin/render-env.sh
exec docker compose run --rm --no-deps -T api node api/dist/auth/ssoAccountErasureCommand.js
