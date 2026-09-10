FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/voice-agent/package.json apps/voice-agent/
RUN pnpm install --frozen-lockfile --filter @ai/voice-agent...

COPY packages/core packages/core
COPY apps/voice-agent apps/voice-agent

EXPOSE 8080

# `start` (src/index.ts) is the M0 health-only boot check: it serves /health
# and nothing else, so a container running it passes Fly's health check, holds
# min_machines_running=1, and reports activeSessions:0 forever while NEVER
# registering with LiveKit or accepting a single interview job. A deployment
# like that looks green and does nothing.
#
# `start:worker` (src/worker.ts) is the real voice pipeline. It serves the same
# /health on the same PORT, so the fly.toml check is unaffected, and it hands
# job dispatch/drain/shutdown to LiveKit's `cli.runApp`.
CMD ["pnpm", "--filter", "@ai/voice-agent", "start:worker"]
