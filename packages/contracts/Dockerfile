# The local chain image: anvil, plus the compiled contracts and Deploy.s.sol for the one-shot deploy job.
# Build context: the repository root.
FROM ghcr.io/foundry-rs/foundry:v1.8.7@sha256:6fec6dc8249fb0231144b159e4ee1d86e486e3dc8eccb09a25e5e16ce494236b

USER root
RUN mkdir -p /app/contracts /data && chown -R foundry:foundry /app /data
USER foundry
WORKDIR /app/contracts

COPY --chown=foundry:foundry packages/contracts/foundry.toml packages/contracts/foundry.lock ./
COPY --chown=foundry:foundry packages/contracts/lib ./lib
COPY --chown=foundry:foundry packages/contracts/src ./src
COPY --chown=foundry:foundry packages/contracts/script ./script
COPY --chown=foundry:foundry packages/contracts/deployments ./deployments
COPY --chown=foundry:foundry packages/contracts/docker-deploy.sh /usr/local/bin/zal-deploy

# Compiles at build time, so the deploy job needs no network and starts in seconds.
RUN forge build --skip test

EXPOSE 8545
ENTRYPOINT ["anvil"]
# The indexer reads contract state at past blocks, so the saved state keeps every block's state, not just the head.
# That state grows to hundreds of MB; dumping it every few seconds stalls RPC and a stop mid-dump corrupts the file.
# Dump every 5 minutes and rely on the save on SIGTERM (compose gives anvil a long stop grace period).
CMD ["--host", "0.0.0.0", "--chain-id", "31337", "--state", "/data/anvil-state.json", "--state-interval", "300", "--preserve-historical-states"]
