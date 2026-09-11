#!/usr/bin/env bash
#
# Instance bootstrap for the voice-agent worker. Amazon Linux 2023, ARM64.
#
# Run this ONCE on a fresh instance, over SSM Session Manager:
#   sudo bash bootstrap.sh
#
# NOT used as EC2 user-data, on purpose. User-data runs unattended at first
# boot, and two steps here need a human: adding the generated deploy key to
# GitHub (the repo is private), and reading the Docker build output. Running it
# interactively means a failure is visible instead of buried in
# /var/log/cloud-init-output.log.
#
# Idempotent: safe to re-run. It will not duplicate swap or re-clone.
set -euo pipefail

REPO_SSH="git@github.com:Anurag9453/ai-interviewer.git"
APP_DIR="/opt/ai-interviewer"
REGION="ap-southeast-1"
LOG_GROUP="/ai-interviewer/voice-agent"

log() { echo "==> $*"; }

# ── 1. packages ──────────────────────────────────────────────────────────
log "installing docker, git, jq"
dnf install -y docker git jq
systemctl enable --now docker

# awscli and the SSM agent are preinstalled on Amazon Linux 2023 — that is
# why AL2023 was chosen over Ubuntu. Verify rather than assume.
command -v aws >/dev/null || dnf install -y awscli
systemctl is-active --quiet amazon-ssm-agent || systemctl enable --now amazon-ssm-agent

# ── 2. swap ──────────────────────────────────────────────────────────────
# t4g.small has 2GB RAM. The image build installs 259 packages including
# onnxruntime-node (~210MB, ships binaries for all five platforms), which can
# exhaust 2GB. 2GB of swap makes the build survivable. It also protects the
# RUNTIME: LiveKit runs each interview job in its own subprocess, so memory
# grows with concurrency.
if ! swapon --show | grep -q '/swapfile'; then
  log "creating 2GB swap"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
  log "swap already present, skipping"
fi

# ── 3. deploy key for the PRIVATE repo ───────────────────────────────────
# The repository is private, so an unauthenticated `git clone` fails. A
# read-only deploy key is used instead of a personal access token: it is
# scoped to this one repo, grants read only, and is revocable from the repo's
# own settings without touching the GitHub account.
KEY=/root/.ssh/ai_interviewer_deploy
if [[ ! -f "$KEY" ]]; then
  log "generating a deploy keypair"
  mkdir -p /root/.ssh && chmod 700 /root/.ssh
  ssh-keygen -t ed25519 -N '' -C 'ai-interviewer-voice-agent-ec2' -f "$KEY"
  cat >> /root/.ssh/config <<EOF
Host github.com
  IdentityFile $KEY
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
EOF
  chmod 600 /root/.ssh/config
fi

if ! git -C "$APP_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  echo
  echo "──────────────────────────────────────────────────────────────────"
  echo "ACTION REQUIRED — add this PUBLIC key as a read-only Deploy Key:"
  echo "  GitHub -> repo -> Settings -> Deploy keys -> Add deploy key"
  echo "  Leave 'Allow write access' UNCHECKED."
  echo
  cat "${KEY}.pub"
  echo "──────────────────────────────────────────────────────────────────"
  echo
  read -r -p "Press Enter once the deploy key is added... " _
  log "cloning $REPO_SSH"
  git clone "$REPO_SSH" "$APP_DIR"
else
  log "repo already cloned; fetching latest"
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" reset --hard origin/master
fi

# ── 4. CloudWatch log group ──────────────────────────────────────────────
# Created here rather than granting the instance logs:CreateLogGroup, so the
# instance role stays read/write on ONE group instead of able to make new ones.
log "ensuring CloudWatch log group exists"
aws logs create-log-group --region "$REGION" --log-group-name "$LOG_GROUP" 2>/dev/null || true
aws logs put-retention-policy --region "$REGION" --log-group-name "$LOG_GROUP" --retention-in-days 30 || true

# ── 5. build the image ───────────────────────────────────────────────────
# Native ARM64 build — no emulation, no --platform needed: the instance IS
# the target architecture. Built from the repo ROOT because this is a pnpm
# workspace and the lockfile lives there.
log "building voice-agent image (this takes several minutes)"
cd "$APP_DIR"
docker build -f apps/voice-agent/Dockerfile -t voice-agent:test .

log "image built:"
docker image inspect voice-agent:test --format '  size: {{.Size}} bytes ({{len .RootFS.Layers}} layers)  arch: {{.Os}}/{{.Architecture}}'

# ── 6. install the runtime scripts and unit ──────────────────────────────
log "installing fetch-secrets.sh and systemd unit"
install -m 0700 -o root -g root "$APP_DIR/deploy/aws/fetch-secrets.sh" /usr/local/bin/fetch-secrets.sh
install -m 0644 -o root -g root "$APP_DIR/deploy/aws/voice-agent.service" /etc/systemd/system/voice-agent.service
systemctl daemon-reload

echo
log "bootstrap complete. NOT started yet — deliberately."
cat <<'NEXT'

Next steps are manual so each gate is verified before the worker goes live:

  1. Verify secrets resolve (prints NAMES only, never values):
       sudo /usr/local/bin/fetch-secrets.sh

  2. SIGTERM test BEFORE installing the service — see RUNBOOK.md step 8.

  3. Only after the SIGTERM test passes:
       sudo docker tag voice-agent:test voice-agent:current
       sudo systemctl enable --now voice-agent

  4. Confirm LiveKit registration in the logs. EC2 running, Docker running,
     and systemd active are NOT evidence of registration.
NEXT
