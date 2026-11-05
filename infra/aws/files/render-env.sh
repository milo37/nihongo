#!/bin/bash
# Reads SecureString parameters under $PARAM_PATH into tmpfs env files.
# Values never touch the disk image or the Terraform state.
set -euo pipefail
source /etc/harumaru/host.env

install -d -m 0700 /run/harumaru
umask 077

aws ssm get-parameters-by-path --region "$AWS_REGION" --path "$PARAM_PATH" \
  --recursive --with-decryption --output json \
  | python3 -c '
import json, sys
params = {p["Name"].rsplit("/", 1)[1]: p["Value"] for p in json.load(sys.stdin)["Parameters"]}
for key, value in params.items():
    if "\n" in value or "\r" in value:
        sys.exit(f"parameter {key} contains a newline")
required = ["POSTGRES_PASSWORD", "DATABASE_URL", "BETTER_AUTH_SECRET", "GUEST_COOKIE_SECRET"]
missing = [k for k in required if k not in params]
if missing:
    sys.exit("missing SSM parameters: " + ", ".join(missing))
groups = {
    "postgres.env": ["POSTGRES_PASSWORD"],
    "migrate.env": ["MIGRATION_DATABASE_URL"],
    "api.env": ["DATABASE_URL", "BETTER_AUTH_SECRET", "GUEST_COOKIE_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
}
for file, keys in groups.items():
    with open(f"/run/harumaru/{file}", "w") as out:
        for key in keys:
            if key in params:
                out.write(f"{key}={params[key]}\n")
'
