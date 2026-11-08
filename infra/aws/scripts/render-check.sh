#!/bin/bash
# Run from infra/aws after terraform init. Renders cloud-init (gzip+base64, the
# EC2 user data) and the host compose file for the HTTP and TLS origin modes.
# The TLS mode (PRODUCTION) runs Caddy from infra/aws/caddy (Cloudflare DNS-01).
set -euo pipefail
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

for domain in "" "origin.example.com"; do
  tls=false
  port=3001
  noindex=true
  [[ -n "$domain" ]] && { tls=true; port=443; noindex=false; }
  compose="templatefile(\"files/compose.yaml.tftpl\", {postgres_image=\"postgres:18.4-alpine\", caddy_image=\"caddy:2\", caddy_dns_image=\"dns.example/caddy@sha256:0\", origin_port=${port}, origin_tls=${tls}, proxy_subnet=\"172.30.0.0/24\", db_subnet=\"172.30.1.0/24\", postgres_address=\"172.30.1.10\"})"
  caddy="templatefile(\"files/Caddyfile.tftpl\", {origin_domain=\"${domain}\", noindex=${noindex}})"
  user_data="base64gzip(templatefile(\"templates/cloud-init.yaml.tftpl\", {region=\"ap-northeast-2\", environment=\"STAGING\", param_path=\"/harumaru/staging\", data_volume_id=\"vol0123\", compose_version=\"v5.7.0\", compose_sha256=\"0\", log_group=\"/harumaru/staging/api\", ecr_repository=\"000000000000.dkr.ecr.ap-northeast-2.amazonaws.com/harumaru/api\", backup_bucket=\"backup\", compose_yaml=base64encode(${compose}), caddyfile=base64encode(${caddy}), deploy_sh=file(\"files/deploy.sh\"), provision_db_sh=file(\"files/provision-db.sh\"), migrate_sh=file(\"files/migrate.sh\"), capability_sh=file(\"files/register-capability.sh\"), render_env_sh=file(\"files/render-env.sh\"), backup_sh=file(\"files/backup.sh\"), erase_sh=file(\"files/erase-deletion-pending.sh\"), guest_cleanup_sh=file(\"files/guest-cleanup.sh\"), cloudwatch_config=base64encode(file(\"files/cloudwatch-agent.json\")), public_env=base64encode(\"A=1\"), origin_tls=${tls}, render_origin_env_sh=file(\"files/render-origin-env.sh\")}))"

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
    # #40: only the TLS origin (PRODUCTION) runs the DNS-01 Caddy with its token and volume.
    proxy = services.fetch("proxy")
    if ARGV[2] == "443"
      raise "TLS proxy must run caddy_dns_image" unless proxy.fetch("image") == "dns.example/caddy@sha256:0"
      raise "TLS proxy needs origin.env" unless proxy.fetch("env_file") == ["/run/harumaru/proxy.env", "/run/harumaru/origin.env"]
      raise "TLS proxy needs caddy-data" unless proxy.fetch("volumes").include?("caddy-data:/data") && compose.fetch("volumes").key?("caddy-data")
      raise "origin token unit missing" unless paths.include?("/etc/systemd/system/harumaru-origin-env.service") && init.fetch("runcmd").include?("systemctl enable --now harumaru-origin-env.service")
    else
      raise "HTTP proxy must run caddy_image" unless proxy.fetch("image") == "caddy:2" && proxy.fetch("env_file") == "/run/harumaru/proxy.env"
      raise "HTTP origin must not have Caddy storage" if compose.key?("volumes")
      raise "HTTP origin must not install the origin token" if paths.any? { |p| p.include?("origin-env") } || init.fetch("runcmd").any? { |c| c.to_s.include?("origin-env") }
    end
    puts "ok origin_port=#{ARGV[2]} files=#{paths.size}"
  ' "$work/cloud-init.yaml" "$work/compose.yaml" "$port"
  echo "user data ${bytes} bytes (gzip before base64, limit 16384)"

  # #742: only STAGING (noindex=true) sends X-Robots-Tag; PRODUCTION has no such line.
  echo "$caddy" | terraform console | sed -e '1s/^<<EOT$//' -e '$s/^EOT$//' > "$work/Caddyfile"
  if [[ "$noindex" == true ]]; then
    grep -qx $'\theader X-Robots-Tag "noindex, nofollow"' "$work/Caddyfile" || { echo "STAGING Caddyfile lacks X-Robots-Tag" >&2; exit 1; }
  elif grep -qi 'x-robots-tag' "$work/Caddyfile"; then
    echo "PRODUCTION Caddyfile must not set X-Robots-Tag" >&2; exit 1
  fi

  # Caddy parses its own config (CI has docker; skipped where docker is absent).
  # The TLS mode needs the DNS provider, so it builds infra/aws/caddy locally.
  # Its token only has to look like one (40 characters), so it is built here
  # rather than written out where the secret scan would flag it.
  if command -v docker >/dev/null 2>&1; then
    if [[ "$tls" == true ]]; then
      docker build --quiet --tag harumaru-caddy-dns:render-check caddy >/dev/null
      image=harumaru-caddy-dns:render-check
    else
      image="$(awk '/variable "caddy_image"/ { found = 1 } found && /default/ { gsub(/.*= "|"$/, ""); print; exit }' variables.tf)"
    fi
    docker run --rm -e ORIGIN_VERIFY_SECRET=render-check -e CLOUDFLARE_API_TOKEN="$(printf 'render%034d' 0)" \
      -v "$work/Caddyfile:/etc/caddy/Caddyfile:ro" \
      "$image" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  fi
done
