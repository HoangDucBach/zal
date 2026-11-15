# The web app as a Next.js standalone server. Build context: the repository root.
# NEXT_PUBLIC_* values are inlined at build time, so the live network is fixed per image.
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
RUN npm install --global pnpm@12.16.1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile --filter @zal/web
COPY packages/web/ ./packages/web/
ARG NEXT_PUBLIC_ZAL_CHAIN_ID
ARG NEXT_PUBLIC_ZAL_RPC_URL
ARG NEXT_PUBLIC_ZAL_CHAIN_NAME
ARG NEXT_PUBLIC_ZAL_API_URL
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_ZAL_CHAIN_ID=$NEXT_PUBLIC_ZAL_CHAIN_ID \
    NEXT_PUBLIC_ZAL_RPC_URL=$NEXT_PUBLIC_ZAL_RPC_URL \
    NEXT_PUBLIC_ZAL_CHAIN_NAME=$NEXT_PUBLIC_ZAL_CHAIN_NAME \
    NEXT_PUBLIC_ZAL_API_URL=$NEXT_PUBLIC_ZAL_API_URL
RUN pnpm --filter @zal/web build

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/packages/web/.next/standalone ./
COPY --from=build --chown=node:node /app/packages/web/.next/static ./packages/web/.next/static
COPY --from=build --chown=node:node /app/packages/web/public ./packages/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=30 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "packages/web/server.js"]
