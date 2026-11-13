# Isolated validation base: Node 24 + git for tests that create Git fixtures.
# Pin the resulting local image digest in the private benchmark policy.
# Never run apt or install dependencies while executing untrusted test code.
FROM node:24-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && git --version && node --version
USER node
WORKDIR /workspace
