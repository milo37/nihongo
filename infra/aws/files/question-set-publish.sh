#!/bin/bash
# Runs the question set command (#837, api/dist/content/questionSetPublishCommand.js)
# for the deployed release. Not installed by cloud-init: scripts/question-set-publish.sh
# sends this file through SSM AWS-RunShellScript with QUESTION_SET_MODE set first.
# - Fetches the ten files of content/question-imports at the deployed SHA (the
#   image does not carry content/), readable by the container user (uid 1000).
# - The operator container gets DATABASE_URL without a password (migrate.env);
#   the command runs on the application login like the admin screen, so the
#   value comes from api.env through the environment, never the command line.
# - Prints only the command's one JSON line (no email, secret or URL in it).
set -euo pipefail
case "${QUESTION_SET_MODE:-}" in
  dry-run) confirm=() ;;
  confirm) confirm=(-e QUESTION_SET_CONFIRM=PUBLISH_QUESTION_SET) ;;
  *) echo "QUESTION_SET_MODE must be dry-run or confirm" >&2; exit 2 ;;
esac
cd /opt/harumaru
release="$(cat /opt/harumaru/current-release)"
[[ "$release" =~ ^[0-9a-f]{40}$ ]] || { echo "current-release is not a full git SHA" >&2; exit 1; }
dir="/opt/harumaru/content/question-set-$release"
install -d -m 755 "$dir"
for file in n5.v1.json n4.v1.json n3.v1.json n2.v1.json n1.v1.json \
  n5.add.v1.json n4.add.v1.json n3.add.v1.json n2.add.v1.json n1.add.v1.json; do
  curl -fsS "https://raw.githubusercontent.com/milo37/nihongo/$release/content/question-imports/$file" \
    -o "$dir/$file"
  chmod 644 "$dir/$file"
done
/opt/harumaru/bin/render-env.sh
DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' /run/harumaru/api.env)"
[ -n "$DATABASE_URL" ] || { echo "api.env has no DATABASE_URL" >&2; exit 1; }
export DATABASE_URL
docker compose --profile operator run --rm --no-deps -T \
  -v "$dir:/run/question-set:ro" -e QUESTION_SET_DIR=/run/question-set \
  -e DATABASE_URL ${confirm[@]+"${confirm[@]}"} \
  --entrypoint node capability api/dist/content/questionSetPublishCommand.js
