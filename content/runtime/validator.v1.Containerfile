FROM node:22.23.0-alpine@sha256:ab07539e0988b63558ff621f5fbe1077054c39d9809112974fb79993949d41cd AS builder

WORKDIR /build

RUN corepack enable \
  && corepack prepare pnpm@10.2.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json

RUN pnpm install --frozen-lockfile

COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/prisma.config.ts
COPY apps/api/src apps/api/src
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/tsconfig.build.json apps/api/tsconfig.build.json
COPY packages/contracts/src packages/contracts/src
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.json
COPY packages/contracts/tsconfig.build.json packages/contracts/tsconfig.build.json
COPY packages/domain/src packages/domain/src
COPY packages/domain/tsconfig.json packages/domain/tsconfig.json
COPY packages/domain/tsconfig.build.json packages/domain/tsconfig.build.json
COPY scripts/content scripts/content
COPY content/README.md content/README.md
COPY content/contributors.v1.json content/contributors.v1.json
COPY content/coverage content/coverage
COPY content/legacy content/legacy
COPY content/policies/original-content-policy.v1.md content/policies/original-content-policy.v1.md
COPY content/policies/policy-activation.schema.v1.json content/policies/policy-activation.schema.v1.json
COPY content/policies/quality-rules.v1.json content/policies/quality-rules.v1.json
COPY content/releases/legacy-system-seed-v1 content/releases/legacy-system-seed-v1
COPY content/review content/review
COPY content/schema content/schema
COPY content/taxonomy content/taxonomy
COPY content/trust content/trust

RUN pnpm run build:contracts \
  && pnpm run build:domain \
  && DATABASE_URL=postgresql://validator:validator@localhost:5432/validator \
    pnpm --filter @nihongo/api run build

FROM node:22.23.0-alpine@sha256:ab07539e0988b63558ff621f5fbe1077054c39d9809112974fb79993949d41cd

ARG OPENSSH_VERSION=9.9p2
ARG OPENSSH_SHA256=91aadb603e08cc285eddf965e1199d02585fa94d994d6cae5b41e1721e215673

RUN apk add --no-cache ca-certificates openssl zlib \
  && apk add --no-cache --virtual .openssh-build \
    build-base linux-headers openssl-dev zlib-dev \
  && wget -q -O /tmp/openssh.tar.gz \
    "https://cdn.openbsd.org/pub/OpenBSD/OpenSSH/portable/openssh-${OPENSSH_VERSION}.tar.gz" \
  && echo "${OPENSSH_SHA256}  /tmp/openssh.tar.gz" | sha256sum -c - \
  && mkdir /tmp/openssh \
  && tar -xzf /tmp/openssh.tar.gz -C /tmp/openssh --strip-components=1 \
  && cd /tmp/openssh \
  && ./configure \
    --prefix=/usr \
    --sysconfdir=/etc/ssh \
    --with-privsep-path=/var/empty \
    --without-openssl-header-check \
  && make -j1 ssh ssh-keygen \
  && install -m 0755 ssh /usr/bin/ssh \
  && install -m 0755 ssh-keygen /usr/bin/ssh-keygen \
  && test "$(node --version)" = "v22.23.0" \
  && test "$(node -p 'process.versions.icu')" = "78.2" \
  && test "$(node -p 'process.versions.unicode')" = "17.0" \
  && ssh -V 2>&1 | grep -F 'OpenSSH_9.9p2' \
  && apk del .openssh-build \
  && rm -rf /tmp/openssh /tmp/openssh.tar.gz /root/.cache

COPY --from=builder /build /opt/validator

ENV NODE_ENV=production \
  CONTENT_REPOSITORY_ROOT=/workspace
WORKDIR /workspace

USER node

ENTRYPOINT ["node", "/opt/validator/apps/api/dist/content/cli.js"]
