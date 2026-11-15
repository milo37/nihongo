#!/bin/bash
# Release gate (#1009): a SHA is released only when its own push runs of CI
# (ci.yml) and Secret scan (secret-scan.yml) both ended in success. Waits while
# they run. Anything else stops the release: failure, cancelled, skipped, timed
# out, no push run within NO_RUN_MINUTES, or still running after WAIT_MINUTES.
# The newest attempt of the newest run counts, so a successful re-run passes.
# Env: GH_TOKEN, GITHUB_API_URL, GITHUB_REPOSITORY, RELEASE_SHA.
set -euo pipefail
sha="${RELEASE_SHA:?RELEASE_SHA is required}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "::error::RELEASE_SHA is not a full git SHA"; exit 1; }
wait_minutes="${WAIT_MINUTES:-60}"
no_run_minutes="${NO_RUN_MINUTES:-10}"
poll_seconds="${POLL_SECONDS:-20}"
api="$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/actions/workflows"
for workflow in ci.yml secret-scan.yml; do
  while :; do
    # An API error reads as "no answer yet"; the deadlines below still apply.
    body=$(curl -fsS -H "Authorization: Bearer $GH_TOKEN" \
      -H 'Accept: application/vnd.github+json' \
      "$api/$workflow/runs?head_sha=$sha&event=push&per_page=20" 2>/dev/null) || body=''
    run=$(printf '%s' "$body" \
      | jq -c '[.workflow_runs[]?] | sort_by(.run_number, .run_attempt) | last // empty' 2>/dev/null) || run=''
    minutes=$((SECONDS / 60))
    if [ -z "$run" ]; then
      if [ "$minutes" -ge "$no_run_minutes" ]; then
        echo "::error::no push run of $workflow for $sha after $no_run_minutes minutes"
        exit 1
      fi
    else
      status=$(jq -r '.status' <<<"$run")
      conclusion=$(jq -r '.conclusion // ""' <<<"$run")
      url=$(jq -r '.html_url' <<<"$run")
      if [ "$status" = completed ]; then
        if [ "$conclusion" = success ]; then
          echo "$workflow success: $url"
          break
        fi
        echo "::error::$workflow ended ${conclusion:-without a conclusion} for $sha: $url"
        exit 1
      fi
      if [ "$minutes" -ge "$wait_minutes" ]; then
        echo "::error::$workflow still $status after $wait_minutes minutes: $url"
        exit 1
      fi
    fi
    sleep "$poll_seconds"
  done
done
