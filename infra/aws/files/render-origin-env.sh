#!/bin/bash
# PRODUCTION only (#40): Caddy's Cloudflare DNS-01 token into tmpfs, at boot.
set -euo pipefail
source /etc/harumaru/host.env

install -d -m 0700 /run/harumaru
umask 077

token="$(aws ssm get-parameter --region "$AWS_REGION" --name "$PARAM_PATH/CLOUDFLARE_API_TOKEN" \
  --with-decryption --query Parameter.Value --output text)"
[[ -n "$token" && "$token" != None && ! "$token" =~ [[:space:]] ]] || { echo "bad CLOUDFLARE_API_TOKEN" >&2; exit 1; }
printf 'CLOUDFLARE_API_TOKEN=%s\n' "$token" > /run/harumaru/origin.env
