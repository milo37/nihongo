#!/bin/bash
# Deploy check (#1009): /health/ready and /health/live both answer 200 with
# x-release-id exactly RELEASE_SHA. A missing header, another release or any
# other status keeps waiting, and after TRIES attempts the deploy fails.
# Env: SITE_URL, RELEASE_SHA; optional TRIES (30), SLEEP_SECONDS (10).
set -uo pipefail
tries="${TRIES:-30}"
sleep_seconds="${SLEEP_SECONDS:-10}"
headers=$(mktemp)
trap 'rm -f "$headers"' EXIT
for ((try = 1; try <= tries; try++)); do
  ok=true
  for path in /health/ready /health/live; do
    : > "$headers"
    code=$(curl -sS -o /dev/null -D "$headers" -w '%{http_code}' "$SITE_URL$path" 2>/dev/null)
    release=$(tr -d '\r' < "$headers" | awk 'tolower($1)=="x-release-id:"{print $2}')
    if [ "$code" != 200 ] || [ "$release" != "$RELEASE_SHA" ]; then
      ok=false
      break
    fi
  done
  if [ "$ok" = true ]; then
    echo "ready and live 200 with release $RELEASE_SHA"
    exit 0
  fi
  [ "$try" -lt "$tries" ] && sleep "$sleep_seconds"
done
echo "::error::$SITE_URL$path gave ${code:-no answer} (release ${release:-none}, expected $RELEASE_SHA)"
exit 1
