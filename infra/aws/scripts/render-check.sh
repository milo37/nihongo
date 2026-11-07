#!/bin/bash
# Run from infra/aws after terraform init. Renders cloud-init (gzip+base64, the
# EC2 user data) and the host compose file for the HTTP and TLS origin modes.
set -euo pipefail
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

for domain in "" "origin.example.com"; do
  tls=false
  port=3001
  [[ -n "$domain" ]] && { tls=true; port=443; }
  compose="templatefile(\"files/compose.yaml.tftpl\", {postgres_image=\"postgres:18.4-alpine\", caddy_image=\"caddy:2\", origin_port=${port}, origin_tls=${tls}, proxy_subnet=\"172.30.0.0/24\", db_subnet=\"172.30.1.0/24\", postgres_address=\"172.30.1.10\"})"
  caddy="templatefile(\"files/Caddyfile.tftpl\", {origin_domain=\"${domain}\"})"
  user_data="base64gzip(templatefile(\"templates/cloud-init.yaml.tftpl\", {region=\"ap-northeast-2\", environment=\"STAGING\", param_path=\"/harumaru/staging\", data_volume_id=\"vol0123\", compose_version=\"v5.7.0\", compose_sha256=\"0\", log_group=\"/harumaru/staging/api\", ecr_repository=\"000000000000.dkr.ecr.ap-northeast-2.amazonaws.com/harumaru/api\", backup_bucket=\"backup\", compose_yaml=base64encode(${compose}), caddyfile=base64encode(${caddy}), deploy_sh=file(\"files/deploy.sh\"), provision_db_sh=file(\"files/provision-db.sh\"), migrate_sh=file(\"files/migrate.sh\"), capability_sh=file(\"files/register-capability.sh\"), render_env_sh=file(\"files/render-env.sh\"), backup_sh=file(\"files/backup.sh\"), erase_sh=file(\"files/erase-deletion-pending.sh\"), guest_cleanup_sh=file(\"files/guest-cleanup.sh\"), cloudwatch_config=base64encode(file(\"files/cloudwatch-agent.json\")), public_env=base64encode(\"A=1\")}))"

  echo "$user_data" | terraform console | tr -d '"' > "$work/user-data.b64"
  # EC2 limits user data to 16 KB before base64 (the gzip bytes); keep 3 KB spare.
  base64 -d < "$work/user-data.b64" > "$work/user-data.gz"
  bytes="$(wc -c < "$work/user-data.gz")"
  (( bytes < 16384 - 3072 )) || { echo "user data too large: $bytes" >&2; exit 1; }
  gunzip < "$work/user-data.gz" > "$work/cloud-init.yaml"
  echo "$compose" | terraform console | sed -e '1s/^<<EOT$//' -e '$s/^EOT$//' > "$work/compose.yaml"

  ruby -ryaml -e '
    init = YAML.safe_load(File.read(ARGV[0]))
    paths = init.fetch("write_files").map { |f| f.fetch("path") }
    %w[/opt/harumaru/compose.yaml /opt/harumaru/Caddyfile /opt/harumaru/bin/deploy.sh /opt/harumaru/bin/provision-db.sh /opt/harumaru/bin/migrate.sh /opt/harumaru/bin/register-capability.sh].each { |p| raise "missing #{p}" unless paths.include?(p) }
    # Host scripts are embedded as YAML text blocks; they must come out byte-identical.
    init.fetch("write_files").select { |f| f.fetch("path").start_with?("/opt/harumaru/bin/") }.each do |f|
      source = File.read("files/#{File.basename(f.fetch("path"))}")
      raise "#{f.fetch("path")} differs from its source" unless f.fetch("content") == source && !f.key?("encoding")
    end
    compose = YAML.safe_load(File.read(ARGV[1]), aliases: true)
    services = compose.fetch("services")
    raise "api must not publish ports" if services.fetch("api").key?("ports")
    raise "proxy must publish #{ARGV[2]}" unless services.fetch("proxy").fetch("ports") == ["#{ARGV[2]}:#{ARGV[2]}"]
    raise "postgres must stay internal" unless services.fetch("postgres").fetch("networks").keys == ["db"]
    # DatabaseCapability records this address; it must not depend on start order.
    raise "postgres needs its fixed address" unless services.fetch("postgres").fetch("networks").fetch("db") == { "ipv4_address" => "172.30.1.10" }
    raise "db network needs its fixed subnet" unless compose.fetch("networks").fetch("db").dig("ipam", "config") == [{ "subnet" => "172.30.1.0/24" }]
    migrate = services.fetch("migrate")
    raise "migrate must be profile-only" unless migrate.fetch("profiles") == ["migrate"]
    raise "migrate must stay internal" unless migrate.fetch("networks") == ["db"] && !migrate.key?("ports")
    capability = services.fetch("capability")
    raise "capability must be profile-only" unless capability.fetch("profiles") == ["operator"]
    raise "capability must stay internal" unless capability.fetch("networks") == ["db"] && !capability.key?("ports")
    raise "capability must use the migration login" unless capability.fetch("env_file").include?("/run/harumaru/migrate.env") && !capability.fetch("env_file").include?("/run/harumaru/api.env")
    raise "api must mount the legal contact file read-only" unless services.fetch("api").fetch("volumes").include?("/var/lib/harumaru/web/legal-settings.json:/app/web/legal-settings.json:ro")
    puts "ok origin_port=#{ARGV[2]} files=#{paths.size}"
  ' "$work/cloud-init.yaml" "$work/compose.yaml" "$port"
  echo "user data ${bytes} bytes (gzip before base64, limit 16384)"

  # Caddy parses its own config (CI has docker; skipped where docker is absent).
  if command -v docker >/dev/null 2>&1; then
    echo "$caddy" | terraform console | sed -e '1s/^<<EOT$//' -e '$s/^EOT$//' > "$work/Caddyfile"
    mkdir -p "$work/tls"
    openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=${domain:-localhost}" \
      -keyout "$work/tls/origin.key" -out "$work/tls/origin.crt" 2>/dev/null
    image="$(awk '/variable "caddy_image"/ { found = 1 } found && /default/ { gsub(/.*= "|"$/, ""); print; exit }' variables.tf)"
    docker run --rm -e ORIGIN_VERIFY_SECRET=render-check \
      -v "$work/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$work/tls:/run/origin-tls:ro" \
      "$image" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  fi
done
