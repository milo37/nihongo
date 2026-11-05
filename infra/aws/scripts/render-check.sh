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
  compose="templatefile(\"files/compose.yaml.tftpl\", {postgres_image=\"postgres:18.4-alpine\", caddy_image=\"caddy:2\", origin_port=${port}, origin_tls=${tls}, proxy_subnet=\"172.30.0.0/24\"})"
  caddy="templatefile(\"files/Caddyfile.tftpl\", {origin_domain=\"${domain}\"})"
  user_data="base64gzip(templatefile(\"templates/cloud-init.yaml.tftpl\", {region=\"ap-northeast-2\", environment=\"STAGING\", param_path=\"/harumaru/staging\", data_volume_id=\"vol0123\", compose_version=\"v5.7.0\", compose_sha256=\"0\", log_group=\"/harumaru/staging/api\", ecr_repository=\"000000000000.dkr.ecr.ap-northeast-2.amazonaws.com/harumaru/api\", backup_bucket=\"backup\", compose_yaml=base64encode(${compose}), caddyfile=base64encode(${caddy}), deploy_sh=filebase64(\"files/deploy.sh\"), render_env_sh=filebase64(\"files/render-env.sh\"), backup_sh=filebase64(\"files/backup.sh\"), erase_sh=filebase64(\"files/erase-deletion-pending.sh\"), cloudwatch_config=base64encode(file(\"files/cloudwatch-agent.json\")), public_env=base64encode(\"A=1\")}))"

  echo "$user_data" | terraform console | tr -d '"' > "$work/user-data.b64"
  bytes="$(wc -c < "$work/user-data.b64")"
  (( bytes < 16384 - 4096 )) || { echo "user data too large: $bytes" >&2; exit 1; }
  base64 -d < "$work/user-data.b64" | gunzip > "$work/cloud-init.yaml"
  echo "$compose" | terraform console | sed -e '1s/^<<EOT$//' -e '$s/^EOT$//' > "$work/compose.yaml"

  ruby -ryaml -e '
    init = YAML.safe_load(File.read(ARGV[0]))
    paths = init.fetch("write_files").map { |f| f.fetch("path") }
    %w[/opt/harumaru/compose.yaml /opt/harumaru/Caddyfile /opt/harumaru/bin/deploy.sh].each { |p| raise "missing #{p}" unless paths.include?(p) }
    compose = YAML.safe_load(File.read(ARGV[1]), aliases: true)
    services = compose.fetch("services")
    raise "api must not publish ports" if services.fetch("api").key?("ports")
    raise "proxy must publish #{ARGV[2]}" unless services.fetch("proxy").fetch("ports") == ["#{ARGV[2]}:#{ARGV[2]}"]
    raise "postgres must stay internal" unless services.fetch("postgres").fetch("networks") == ["db"]
    puts "ok origin_port=#{ARGV[2]} files=#{paths.size}"
  ' "$work/cloud-init.yaml" "$work/compose.yaml" "$port"
  echo "user data ${bytes} bytes (base64, limit 16384)"

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
