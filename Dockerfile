FROM node:22.23.0-alpine@sha256:ab07539e0988b63558ff621f5fbe1077054c39d9809112974fb79993949d41cd AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@10.2.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
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
RUN cp -R apps/web/dist /release/web
RUN node scripts/operations/release-manifest.mjs --mode create-oci-component --workspace /workspace --release-id "$RELEASE_ID" --api-directory /release/api --web-directory /release/web --output /release/release-manifest.json

FROM node:22.23.0-alpine@sha256:ab07539e0988b63558ff621f5fbe1077054c39d9809112974fb79993949d41cd AS runtime

ARG RELEASE_ID
LABEL org.opencontainers.image.title="JLPT Drill Note"
LABEL org.opencontainers.image.revision=$RELEASE_ID

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV RELEASE_ID=$RELEASE_ID
WORKDIR /app

COPY --from=builder /release/api /app/api
COPY --from=builder /release/web /app/web
COPY --from=builder /release/release-manifest.json /app/release-manifest.json

USER node
EXPOSE 3001
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "const p=Number(process.env.PORT);if(!Number.isInteger(p)||p<1||p>65535)process.exit(1);fetch(`http://127.0.0.1:${p}/health/live`,{redirect:'error'}).then(r=>{if(r.status!==200||r.headers.get('x-release-id')!==process.env.RELEASE_ID)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "api/dist/server.js"]
