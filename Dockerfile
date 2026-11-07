FROM node:22.23.0-alpine@sha256:ab07539e0988b63558ff621f5fbe1077054c39d9809112974fb79993949d41cd AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@10.2.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY packages/browser/package.json packages/browser/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY scripts/msw/patch-worker.mjs scripts/msw/patch-worker.mjs
COPY apps/web/public/mockServiceWorker.js apps/web/public/mockServiceWorker.js
RUN pnpm install --frozen-lockfile

COPY . .

ARG RELEASE_ID
ENV NIHONGO_RELEASE_BUILD=1
ENV NIHONGO_OCI_BUILD=1
ENV NODE_ENV=production
ENV RELEASE_ID=$RELEASE_ID
ENV VITE_API_BASE_URL=/api
ENV VITE_API_MODE=real
ENV VITE_RELEASE_ID=$RELEASE_ID

RUN node -e "const id=process.env.RELEASE_ID;if(!/^[0-9a-f]{40}$/.test(id)||/^0+$/.test(id))process.exit(1)"
RUN pnpm run build
RUN pnpm --filter @nihongo/api deploy --prod --legacy /release/api
RUN node scripts/operations/normalize-api-deploy.mjs --api-directory /release/api --workspace-api-directory /workspace/apps/api
RUN test -f /release/api/dist/study/studyGuestCleanupRuntime.js && test -f /release/api/dist/study/studyGuestCleanupCommand.js
RUN cp -R apps/web/dist /release/web
RUN cp -R apps/admin/dist /release/admin
RUN node scripts/operations/release-manifest.mjs --mode create-oci-component --workspace /workspace --release-id "$RELEASE_ID" --api-directory /release/api --web-directory /release/web --admin-directory /release/admin --output /release/release-manifest.json

# Production migrations (`docker build --target migrate`, pushed as <sha>-migrate).
# Prisma CLI is a devDependency, so it never reaches the runtime image. BuildKit
# skips these two stages when the default (runtime) target is built.
FROM builder AS migrate-deps
RUN pnpm --filter @nihongo/api deploy --legacy /release/migrate
# Keep only what `prisma migrate deploy` with prisma.migrate.config.ts loads: the
# pnpm closure of prisma and dotenv, at the lockfile versions. typescript is an
# optional peer of prisma that migrate does not use (the config loads via jiti).
RUN node - /release/migrate/node_modules /release/migrate-min/node_modules typescript -- prisma dotenv <<'EOF'
const fs = require('node:fs')
const path = require('node:path')
const [source, target, ...rest] = process.argv.slice(2)
const split = rest.indexOf('--')
const excluded = new Set(rest.slice(0, split))
const roots = rest.slice(split + 1)
const marker = `${path.sep}node_modules${path.sep}`
const stores = new Set()
const queue = roots.map((name) => fs.realpathSync(path.join(source, name)))
while (queue.length > 0) {
  const real = queue.pop()
  const store = real.slice(0, real.lastIndexOf(marker))
  if (stores.has(store)) continue
  stores.add(store)
  const modules = path.join(store, 'node_modules')
  for (const entry of fs.readdirSync(modules)) {
    const names = entry.startsWith('@')
      ? fs.readdirSync(path.join(modules, entry)).map((name) => `${entry}/${name}`)
      : [entry]
    for (const name of names) {
      const link = path.join(modules, name)
      if (!excluded.has(name) && fs.existsSync(link)) queue.push(fs.realpathSync(link))
    }
  }
}
for (const store of stores) {
  fs.cpSync(store, path.join(target, '.pnpm', path.basename(store)), { recursive: true, verbatimSymlinks: true })
}
for (const name of roots) {
  const real = fs.realpathSync(path.join(source, name))
  const link = path.join(target, name)
  fs.mkdirSync(path.dirname(link), { recursive: true })
  fs.symlinkSync(path.relative(path.dirname(link), path.join(target, path.relative(source, real))), link)
}
console.log(`migrate image keeps ${stores.size} packages`)
EOF

FROM node:22.23.0-alpine@sha256:ab07539e0988b63558ff621f5fbe1077054c39d9809112974fb79993949d41cd AS migrate

ARG RELEASE_ID
LABEL org.opencontainers.image.title="하루마루 migrate"
LABEL org.opencontainers.image.revision=$RELEASE_ID

ENV NODE_ENV=production
ENV RELEASE_ID=$RELEASE_ID
WORKDIR /migrate

COPY --from=migrate-deps /release/migrate-min/node_modules /migrate/node_modules
# The deploy output keeps only package.json "files"; take the rest from the source tree.
COPY --from=migrate-deps /release/migrate/package.json /migrate/package.json
COPY --from=builder /workspace/apps/api/prisma.migrate.config.ts /migrate/prisma.migrate.config.ts
COPY --from=builder /workspace/apps/api/prisma/schema.prisma /migrate/prisma/schema.prisma
COPY --from=builder /workspace/apps/api/prisma/migrations /migrate/prisma/migrations
COPY --from=builder /workspace/apps/api/src/db/databaseTargetGuard.ts /migrate/src/db/databaseTargetGuard.ts

USER node
ENTRYPOINT ["node", "node_modules/prisma/build/index.js"]
CMD ["migrate", "deploy", "--config", "prisma.migrate.config.ts"]

FROM node:22.23.0-alpine@sha256:ab07539e0988b63558ff621f5fbe1077054c39d9809112974fb79993949d41cd AS runtime

ARG RELEASE_ID
LABEL org.opencontainers.image.title="하루마루"
LABEL org.opencontainers.image.revision=$RELEASE_ID

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV RELEASE_ID=$RELEASE_ID
WORKDIR /app

COPY --from=builder /release/api /app/api
COPY --from=builder /release/web /app/web
COPY --from=builder /release/admin /app/admin
COPY --from=builder /release/release-manifest.json /app/release-manifest.json

USER node
EXPOSE 3001
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "const p=Number(process.env.PORT);if(!Number.isInteger(p)||p<1||p>65535)process.exit(1);fetch(`http://127.0.0.1:${p}/health/live`,{redirect:'error'}).then(r=>{if(r.status!==200||r.headers.get('x-release-id')!==process.env.RELEASE_ID)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "api/dist/server.js"]
