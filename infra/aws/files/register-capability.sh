#!/bin/bash
# register-capability.sh: the API is not ready without a current DatabaseCapability
# row. deploy.sh runs this after migrate.sh: write the row if absent, keep it if
# current, refuse a row for another environment or a stale one (runbook:
# operations/runbooks/production-database.v1.md step 5).
set -euo pipefail
cd /opt/harumaru

fail() {
  echo "register-capability refused: $1" >&2
  exit 1
}

capability() {
  docker compose --profile operator run --rm --no-deps -T "$@" capability
}

field() {
  python3 -c 'import json, sys
value = json.loads(sys.stdin.read()).get(sys.argv[1])
print("" if value is None else value)' "$1"
}

report="$(capability)" || fail 'dry run failed.'
environment="$(field environment <<< "$report")"
registered="$(field registered <<< "$report")"
[[ "$environment" =~ ^[A-Z]+$ ]] || fail 'dry run did not name the environment.'

if [[ -z "$registered" ]]; then
  capability -e DATABASE_CAPABILITY_CONFIRM=REGISTER_DATABASE_CAPABILITY >/dev/null \
    || fail 'write failed.'
  echo "database capability registered: $environment"
elif [[ "$registered" != "$environment" ]]; then
  fail "the row names $registered, this host is $environment."
fi

# The check the API runs, over TCP to the address the API connects to.
printf "SELECT require_database_capability(:'environment');\n" \
  | docker compose exec -T postgres sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -h postgres -U postgres -d nihongo -qAt -v ON_ERROR_STOP=1 -v environment="$1"' \
    sh "$environment" >/dev/null 2>&1 \
  || fail 'the row does not match this database, address or port (stale).'
echo "database capability current: $environment"
