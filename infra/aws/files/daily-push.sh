#!/bin/bash
# shellcheck disable=SC2154 # send and WEB_PUSH_SUBJECT come from the SSM document lines.
# #1046: one run of the 08:00 daily web push (dailyPushCommand.js) from the
# deployed image. send=false only counts (daily_push_dry_run line). Exit 0 =
# done; 1 = failed or nothing could be sent. The SSM document puts the send and
# subject lines in front of these, so a change reaches running hosts with apply
# alone (no cloud-init file).
set -euo pipefail
cd /opt/harumaru
[[ -f .env ]] || { echo "no deployed release" >&2; exit 1; }
case "$send" in true | false) ;; *) echo "send must be true or false" >&2; exit 1 ;; esac
source /etc/harumaru/host.env

/opt/harumaru/bin/render-env.sh
# The operator guard compares the identity of the migration, runtime and
# production URLs, never their passwords: take the migration URL from
# migrate.env without its password, and PRODUCTION_DATABASE_URL literally from
# erase.env (never `source`d, so nothing in a value is run by the shell).
MIGRATION_DATABASE_URL="$(python3 -c '
import sys
from urllib.parse import urlsplit, urlunsplit
for line in sys.stdin:
    key, _, value = line.rstrip("\n").partition("=")
    if key == "MIGRATION_DATABASE_URL":
        url = urlsplit(value)
        userinfo, _, host = url.netloc.rpartition("@")
        print(urlunsplit(url._replace(netloc=userinfo.partition(":")[0] + "@" + host)))
' < /run/harumaru/migrate.env)"
PRODUCTION_DATABASE_URL=''
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    '') ;;
    PRODUCTION_DATABASE_URL=*) PRODUCTION_DATABASE_URL="${line#PRODUCTION_DATABASE_URL=}" ;;
    *) echo "unexpected line in erase.env" >&2; exit 1 ;;
  esac
done < /run/harumaru/erase.env
[[ -n "$MIGRATION_DATABASE_URL" && -n "$PRODUCTION_DATABASE_URL" ]] || { echo "missing database URL parameters" >&2; exit 1; }

# The VAPID key pair: SecureString parameters the operator writes once (README).
key() {
  aws ssm get-parameter --region "$AWS_REGION" --name "$PARAM_PATH/$1" \
    --with-decryption --query Parameter.Value --output text
}
WEB_PUSH_PUBLIC_KEY="$(key WEB_PUSH_PUBLIC_KEY)"
WEB_PUSH_PRIVATE_KEY="$(key WEB_PUSH_PRIVATE_KEY)"
export MIGRATION_DATABASE_URL PRODUCTION_DATABASE_URL WEB_PUSH_PUBLIC_KEY WEB_PUSH_PRIVATE_KEY WEB_PUSH_SUBJECT

confirm=()
if [[ "$send" == true ]]; then
  export DAILY_PUSH_CONFIRM=SEND_DAILY_PUSH
  confirm=(-e DAILY_PUSH_CONFIRM)
fi
# The api service: DATABASE_URL comes from api.env, and its edge network
# reaches the browsers' push services (the db network is internal). Values come
# from this shell's environment, so no URL or key appears in argv.
exec docker compose run --rm --no-deps -T \
  -e MIGRATION_DATABASE_URL -e PRODUCTION_DATABASE_URL \
  -e WEB_PUSH_PUBLIC_KEY -e WEB_PUSH_PRIVATE_KEY -e WEB_PUSH_SUBJECT ${confirm[@]+"${confirm[@]}"} \
  api node api/dist/notification/dailyPushCommand.js
