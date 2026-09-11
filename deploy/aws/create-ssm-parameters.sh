#!/usr/bin/env bash
#
# Creates the seven SecureString parameters the voice-agent reads at boot.
#
# HOW TO USE THIS SAFELY
#   1. Copy this file somewhere OUTSIDE the repository:
#        cp deploy/aws/create-ssm-parameters.sh ~/ssm-params.sh
#   2. Replace each REPLACE_ME in YOUR COPY with the real value.
#   3. chmod 700 ~/ssm-params.sh && ~/ssm-params.sh
#   4. Delete your copy afterwards:  rm -P ~/ssm-params.sh
#
# Never commit a filled-in copy. Never paste real values into a chat or an
# issue. The committed version of this file contains only placeholders, and
# the repo's .gitignore does not cover an edited copy left inside the tree —
# which is exactly why step 1 says to copy it out.
#
# Values are passed via --value on the command line, which is visible in
# `ps` while the command runs. That is acceptable on your own laptop for a
# one-time setup; if you'd rather avoid it entirely, set each parameter in the
# AWS console instead (Systems Manager -> Parameter Store -> Create parameter,
# type SecureString).
set -euo pipefail

REGION="ap-southeast-1"
PREFIX="/ai-interviewer/voice"

# Uses the AWS-managed key (alias/aws/ssm) by default. To use a customer
# managed key, add: --key-id alias/your-key
put() {
  local name="$1" value="$2"
  if [[ "$value" == "REPLACE_ME" ]]; then
    echo "refusing to write placeholder value for ${PREFIX}/${name}" >&2
    exit 1
  fi
  aws ssm put-parameter \
    --region "$REGION" \
    --name "${PREFIX}/${name}" \
    --type SecureString \
    --value "$value" \
    --overwrite \
    --no-cli-pager \
    --output text --query Version >/dev/null
  echo "  set ${PREFIX}/${name}"
}

put DATABASE_URL        "REPLACE_ME"
put LIVEKIT_URL         "REPLACE_ME"
put LIVEKIT_API_KEY     "REPLACE_ME"
put LIVEKIT_API_SECRET  "REPLACE_ME"
put DEEPGRAM_API_KEY    "REPLACE_ME"
put CARTESIA_API_KEY    "REPLACE_ME"
put ANTHROPIC_API_KEY   "REPLACE_ME"

echo
echo "Done. Verify NAMES ONLY (this prints no values):"
echo "  aws ssm get-parameters-by-path --region $REGION --path $PREFIX --query 'Parameters[].Name' --output table"
echo
echo "PORT and AI_PROVIDER are deliberately NOT stored here — they are"
echo "non-secret and are passed directly by the systemd unit."
