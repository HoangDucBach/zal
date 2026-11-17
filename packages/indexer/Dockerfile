# The indexer and /v1 API. Build context: the repository root.
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS deps
RUN npm install --global pnpm@12.16.1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/indexer/package.json packages/indexer/
RUN pnpm install --frozen-lockfile --prod --filter @zal/indexer

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/indexer/node_modules ./packages/indexer/node_modules
COPY packages/indexer/ ./packages/indexer/
WORKDIR /app/packages/indexer
# Ponder refuses a schema that other indexing code built, so each build indexes into a schema named after the
# inputs Ponder hashes into its build id: config, schema, ABIs and handlers. An API-only change keeps the schema.
RUN cat ponder.config.ts ponder.schema.ts abis/index.ts src/*.ts lib/feed-channel.ts lib/deployment.ts lib/explorer/chain.ts lib/explorer/decode.ts \
      | sha256sum | cut -c1-12 > .schema-id \
  && chown -R node:node /app/packages/indexer
USER node
EXPOSE 42069
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=60 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:42069/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["./docker-entrypoint.sh"]
