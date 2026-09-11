#!/usr/bin/env bash
#
# Fetches the voice-agent's secrets from SSM Parameter Store into a
# root-only env file for `docker run --env-file`.
#
# Design notes:
#  - Writes to /run (tmpfs): never touches disk, disappears on reboot.
#  - umask 077 before creation, so the file is 0600 root:root from birth —
#    there is no window where it exists world-readable.
#  - Values are never echoed. Only parameter NAMES are printed.
#  - Uses --env-file rather than `-e VAR="$(...)"` deliberately: the latter
#    would expose every secret in `ps` output for the life of the container.
#  - The application reads plain process.env and knows nothing about AWS, so
#    this file is the only AWS-specific piece of the runtime.
#
# Installed to: /usr/local/bin/fetch-secrets.sh
set -euo pipefail

REGION="ap-southeast-1"
PREFIX="/ai-interviewer/voice"
OUT="/run/voice-agent.env"

REQUIRED=(
  DATABASE_URL
  LIVEKIT_URL
  LIVEKIT_API_KEY
  LIVEKIT_API_SECRET
  DEEPGRAM_API_KEY
  CARTESIA_API_KEY
  ANTHROPIC_API_KEY
)

umask 077
TMP="$(mktemp /run/voice-agent.env.XXXXXX)"
trap 'rm -f "$TMP"' EXIT

# One call for all parameters. --with-decryption requires kms:Decrypt, which
# the instance role grants only via ssm.
json="$(aws ssm get-parameters-by-path \
  --region "$REGION" \
  --path "$PREFIX" \
  --with-decryption \
  --recursive \
  --output json)"

# jq writes KEY=VALUE with no quoting: docker's --env-file format treats
# everything after the first '=' literally and does NOT process quotes, so
# adding them would inject literal quote characters into the values.
echo "$json" | jq -r '.Parameters[] | (.Name | split("/") | last) + "=" + .Value' > "$TMP"

# Fail loudly and BEFORE starting the container if anything is missing.
# env.ts would also fail fast, but failing here keeps a broken config from
# ever becoming a running container that looks alive.
missing=()
for key in "${REQUIRED[@]}"; do
  grep -q "^${key}=" "$TMP" || missing+=("$key")
done
if (( ${#missing[@]} > 0 )); then
  echo "fetch-secrets: missing SSM parameters: ${missing[*]}" >&2
  exit 1
fi

# Reject empty values — an empty SecureString would pass env.ts's presence
# check in some cases and fail confusingly later.
while IFS='=' read -r k v; do
  if [[ -z "${v:-}" ]]; then
    echo "fetch-secrets: parameter ${PREFIX}/${k} is empty" >&2
    exit 1
  fi
done < "$TMP"

mv -f "$TMP" "$OUT"
chmod 600 "$OUT"
chown root:root "$OUT"
trap - EXIT

# Names only — never values.
echo "fetch-secrets: wrote $(wc -l < "$OUT" | tr -d ' ') parameters to $OUT"
echo "fetch-secrets: keys = $(cut -d= -f1 "$OUT" | sort | tr '\n' ' ')"
