# Voice-agent worker image. Host-agnostic: no Fly-, Render-, or
# vendor-specific assumptions. Built from the REPO ROOT as context, because
# this is a pnpm workspace and the lockfile lives there:
#
#   docker build -f apps/voice-agent/Dockerfile .
#
# Architecture: intentionally NOT pinned with --platform. The image must be
# built for the architecture that will run it (Render builds and runs
# linux/amd64, so its own builder is correct). onnxruntime-node and
# @livekit/local-inference both ship per-architecture native binaries, so a
# cross-architecture image fails to load the VAD at runtime. When
# test-building on an Apple Silicon machine, pass `--platform=linux/amd64`.
#
# Base image must stay glibc — do NOT switch to node:22-alpine. The lockfile
# resolves @livekit/local-inference-linux-x64-GNU for Linux; there is no musl
# variant among the published platform packages, so Alpine would install no
# native inference binary and the VAD would fail at prewarm.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH

# Debian slim ships without a CA trust store, and @livekit/rtc-node is a
# NATIVE Rust WebRTC component that reads the operating system's store rather
# than Node's bundled one. Without this, the worker registers with LiveKit
# and accepts jobs perfectly well (that path is Node TLS), then dies the
# moment it tries to join the room:
#
#   ConnectError: engine: signal failure: transport connection error:
#   IO error: no native root CA certificates found (errors: [])
#
# Observed in production on 2026-09-11: two interviews consumed a credit each,
# both stuck at status=configuring, surfacing to the candidate as "The
# interviewer didn't join". Neither `docker build` nor /health can catch this —
# it only appears on a real room connection.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

# Root manifests first, so dependency resolution is cached independently of
# source changes.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./

# EVERY workspace importer declared in pnpm-workspace.yaml ("apps/*",
# "packages/*", "content") must exist before install, or --frozen-lockfile
# fails with ERR_PNPM_OUTDATED_LOCKFILE: pnpm validates the lockfile against
# the whole workspace, not just the filtered subgraph. apps/web and content
# are needed as MANIFESTS ONLY — their sources are never copied, and
# `--filter @ai/voice-agent...` still installs only the worker's subgraph.
COPY packages/core/package.json packages/core/
COPY apps/voice-agent/package.json apps/voice-agent/
COPY apps/web/package.json apps/web/
COPY content/package.json content/

# Install scripts must run: onnxruntime-node compiles/downloads its native
# artifact and @livekit/local-inference fetches model assets. Both are
# allow-listed in pnpm-workspace.yaml's `allowBuilds`, so do NOT add
# --ignore-scripts here — the Silero VAD would then fail at runtime.
RUN pnpm install --frozen-lockfile --filter @ai/voice-agent...

# Sources last. Only what the worker actually needs.
COPY packages/core packages/core
COPY apps/voice-agent apps/voice-agent

# The worker makes only OUTBOUND connections (LiveKit, Deepgram, Cartesia,
# Anthropic, Postgres). This port serves /health for local and platform
# checks; as a Render Background Worker it is not publicly routed, which is
# the intended posture rather than a limitation.
EXPOSE 8080

# `start` (src/index.ts) is the M0 health-only boot check: it serves /health
# and nothing else, so a container running it passes a platform health check,
# holds a machine, and reports activeSessions:0 forever while NEVER
# registering with LiveKit or accepting a single interview job. A deployment
# like that looks green and does nothing.
#
# `start:worker` (src/worker.ts) is the real voice pipeline. It serves the
# same /health on the same PORT and hands job dispatch, drain and shutdown to
# LiveKit's `cli.runApp`.
#
# This runs TypeScript through tsx at runtime by design: @ai/core is consumed
# as TypeScript source (its package exports point at ./src/index.ts), so
# compiling the worker alone would emit imports of a .ts file Node cannot
# load. `tsx` is therefore a real runtime dependency, not a dev tool, and
# lives in `dependencies` so a production install cannot omit it.
CMD ["pnpm", "--filter", "@ai/voice-agent", "start:worker"]
