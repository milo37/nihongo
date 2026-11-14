#!/bin/bash
# Runs the Japanese explanation command (#976, api/dist/content/explanationJaPublishCommand.js)
# for the deployed release. Not installed by cloud-init: scripts/explanation-ja-publish.sh
# sends this file through SSM AWS-RunShellScript with EXPLANATION_JA_MODE set first.
# - Fetches the ten files of content/question-imports (they locate each question)
#   and content/translations/explanations-ja.v1.json at the deployed SHA (the
#   image does not carry content/), readable by the container user (uid 1000).
# - The command runs on the application login like question-set-publish.sh: the
#   value comes from api.env through the environment, never the command line.
# - Prints only the command's one JSON line (no email, secret or URL in it).
set -euo pipefail
case "${EXPLANATION_JA_MODE:-}" in
  dry-run) confirm=() ;;
  confirm) confirm=(-e EXPLANATION_JA_CONFIRM=PUBLISH_EXPLANATION_JA) ;;
  *) echo "EXPLANATION_JA_MODE must be dry-run or confirm" >&2; exit 2 ;;
esac
cd /opt/harumaru
release="$(cat /opt/harumaru/current-release)"
[[ "$release" =~ ^[0-9a-f]{40}$ ]] || { echo "current-release is not a full git SHA" >&2; exit 1; }
raw="https://raw.githubusercontent.com/milo37/nihongo/$release/content"
dir="/opt/harumaru/content/explanation-ja-$release"
install -d -m 755 "$dir" "$dir/set"
for file in n5.v1.json n4.v1.json n3.v1.json n2.v1.json n1.v1.json \
  n5.add.v1.json n4.add.v1.json n3.add.v1.json n2.add.v1.json n1.add.v1.json; do
  curl -fsS "$raw/question-imports/$file" -o "$dir/set/$file"
  chmod 644 "$dir/set/$file"
done
curl -fsS "$raw/translations/explanations-ja.v1.json" -o "$dir/explanations-ja.v1.json"
chmod 644 "$dir/explanations-ja.v1.json"
/opt/harumaru/bin/render-env.sh
DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' /run/harumaru/api.env)"
[ -n "$DATABASE_URL" ] || { echo "api.env has no DATABASE_URL" >&2; exit 1; }
export DATABASE_URL
docker compose --profile operator run --rm --no-deps -T \
  -v "$dir:/run/explanation-ja:ro" -e QUESTION_SET_DIR=/run/explanation-ja/set \
  -e EXPLANATION_JA_FILE=/run/explanation-ja/explanations-ja.v1.json \
  -e DATABASE_URL ${confirm[@]+"${confirm[@]}"} \
  --entrypoint node capability api/dist/content/explanationJaPublishCommand.js
