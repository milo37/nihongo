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
required = [
    "POSTGRES_PASSWORD", "DATABASE_URL", "MIGRATION_DATABASE_URL", "PRODUCTION_DATABASE_URL",
    "BETTER_AUTH_SECRET", "GUEST_COOKIE_SECRET", "ORIGIN_VERIFY_SECRET",
    "PROD_MIGRATION_LOGIN_PASSWORD", "PROD_APP_LOGIN_PASSWORD", "PROD_GUEST_CLEANUP_LOGIN_PASSWORD",
    # Google is the only sign-in; without it the site starts but nobody can log in.
    "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
]
missing = [k for k in required if k not in params]
if missing:
    sys.exit("missing SSM parameters: " + ", ".join(missing))
groups = {
    "postgres.env": ["POSTGRES_PASSWORD"],
    # The migration guard compares host, port, database, schema and login of the
    # runtime and production URLs with the target, never their passwords, so the
    # migrate container gets those two without a password (stripped below).
    "migrate.env": ["MIGRATION_DATABASE_URL", "DATABASE_URL", "PRODUCTION_DATABASE_URL"],
    # Wrapper login passwords for provision-db.sh only.
    "provision.env": ["PROD_MIGRATION_LOGIN_PASSWORD", "PROD_APP_LOGIN_PASSWORD", "PROD_GUEST_CLEANUP_LOGIN_PASSWORD"],
    "api.env": ["DATABASE_URL", "BETTER_AUTH_SECRET", "GUEST_COOKIE_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    "proxy.env": ["ORIGIN_VERIFY_SECRET"],
    # Account erasure only (#57); never part of the API runtime environment.
    "erase.env": ["PRODUCTION_DATABASE_URL"],
}
import os
from urllib.parse import urlsplit, urlunsplit
def without_password(value):
    url = urlsplit(value)
    if url.password is None:
        return value
    userinfo, _, host = url.netloc.rpartition("@")
    return urlunsplit(url._replace(netloc=userinfo.partition(":")[0] + "@" + host))
identity_only = {("migrate.env", "DATABASE_URL"), ("migrate.env", "PRODUCTION_DATABASE_URL")}
for file, keys in groups.items():
    with open(f"/run/harumaru/{file}", "w") as out:
        for key in keys:
            if key in params:
                value = without_password(params[key]) if (file, key) in identity_only else params[key]
                out.write(f"{key}={value}\n")
# Legal contact shown on /legal and /support (#705). Optional: without them the
# page shows its fallback copy, which is how STAGING runs. The file is on the
# data disk, not tmpfs: after a reboot Docker restarts the API before this
# script runs, and a missing bind source would become a directory. Written in
# place so the mounted file changes without restarting the API. Readable by the
# container user; the values are public on the page anyway.
import json
legal = {}
for field, key in (("contactEmail", "LEGAL_CONTACT_EMAIL"), ("privacyOfficer", "LEGAL_PRIVACY_OFFICER")):
    if key in params:
        if not params[key].strip() or len(params[key].strip()) > 200:
            sys.exit(f"parameter {key} must be 1-200 characters")
        legal[field] = params[key].strip()
legal_path = "/var/lib/harumaru/web/legal-settings.json"
os.makedirs(os.path.dirname(legal_path), exist_ok=True)
with open(legal_path, "w") as out:
    json.dump(legal, out)
os.chmod(legal_path, 0o644)
# Origin TLS (only with origin_domain_name): PEM files stored base64 in SSM.
import base64
if "ORIGIN_TLS_CERT_B64" in params and "ORIGIN_TLS_KEY_B64" in params:
    os.makedirs("/run/harumaru/origin-tls", mode=0o700, exist_ok=True)
    for name, key in (("origin.crt", "ORIGIN_TLS_CERT_B64"), ("origin.key", "ORIGIN_TLS_KEY_B64")):
        with open(f"/run/harumaru/origin-tls/{name}", "wb") as out:
            out.write(base64.b64decode(params[key], validate=True))
'
