#!/bin/bash
# Run from infra/aws with `aws login` and the environment's terraform state:
#   bash scripts/question-set-publish.sh dry-run   # reports only
#   bash scripts/question-set-publish.sh confirm   # imports, reviews, approves, publishes
# Sends files/question-set-publish.sh to the host (SSM AWS-RunShellScript),
# waits, and prints the status and the command's JSON line only.
set -euo pipefail
mode="${1:-}"
case "$mode" in dry-run|confirm) ;; *) echo "usage: $0 dry-run|confirm" >&2; exit 2 ;; esac
iid="${INSTANCE_ID:-$(terraform output -raw instance_id)}"
params="$(python3 - "$mode" files/question-set-publish.sh <<'PY'
import json, sys
mode, path = sys.argv[1], sys.argv[2]
lines = open(path).read().splitlines()
print(json.dumps({"commands": [f"export QUESTION_SET_MODE={mode}"] + lines, "executionTimeout": ["1800"]}))
PY
)"
cid="$(aws ssm send-command --instance-ids "$iid" --document-name AWS-RunShellScript \
  --comment "question-set-publish $mode" --parameters "$params" \
  --query Command.CommandId --output text)"
echo "command $cid"
while :; do
  st="$(aws ssm get-command-invocation --command-id "$cid" --instance-id "$iid" \
    --query Status --output text 2>/dev/null || true)"
  case "$st" in Pending|InProgress|Delayed|"") sleep 10 ;; *) break ;; esac
done
echo "status $st"
for field in StandardOutputContent StandardErrorContent; do
  aws ssm get-command-invocation --command-id "$cid" --instance-id "$iid" \
    --query "$field" --output text
done | grep -E '^(\{"event":"question_set_|QUESTION_SET_MODE|current-release|api.env|curl: )' || true
[ "$st" = Success ]
