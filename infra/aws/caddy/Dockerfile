# PRODUCTION origin proxy (origin_domain_name set, #40): Caddy plus the Cloudflare
# DNS provider, so Caddy obtains and renews the origin certificate from Let's
# Encrypt over DNS-01. HTTP-01 and TLS-ALPN-01 cannot work here: the security
# group admits only CloudFront. Built natively on arm64 and pushed to the
# PRODUCTION-only ECR repository by .github/workflows/caddy-image.yml; the host
# pins the pushed digest (variable caddy_dns_image). STAGING keeps caddy_image.
FROM caddy:2.11.8-builder-alpine@sha256:e42a64b3bc70aa3a1387bde85b930e507a378fecae5852d5bfde9dcd37d0b999 AS build
RUN xcaddy build v2.11.8 --with github.com/caddy-dns/cloudflare@v0.2.4

# Same base as caddy_image.
FROM caddy:2.11.8-alpine@sha256:f6228111e5fafa1a5238258d0858e103f10599b8d1659a146e7726681a002bb9
COPY --from=build /usr/bin/caddy /usr/bin/caddy
