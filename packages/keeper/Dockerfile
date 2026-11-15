# The keeper (ADR 0015). Build context: the repository root.
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS deps
RUN npm install --global pnpm@12.16.1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/keeper/package.json packages/keeper/
RUN pnpm install --frozen-lockfile --prod --filter @zal/keeper

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/keeper/node_modules ./packages/keeper/node_modules
COPY packages/keeper/package.json ./packages/keeper/
COPY packages/keeper/abis ./packages/keeper/abis
COPY packages/keeper/lib ./packages/keeper/lib
COPY packages/keeper/src ./packages/keeper/src
WORKDIR /app/packages/keeper
USER node
EXPOSE 42070
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=12 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:42070/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["node", "src/main.ts"]
