/**
 * Mints a LiveKit participant token for manual voice testing.
 *
 * Mirrors what /api/interviews issues in the real app — same grants and the
 * same participant attributes agent.ts reads (interviewId et al) — so a
 * manual room join exercises the identical path a real candidate would.
 *
 *   set -a && source ../../.env && set +a
 *   pnpm --filter @ai/web exec tsx scripts/dev-token.ts [roomName]
 */
import { AccessToken } from "livekit-server-sdk";

async function main() {
const room = process.argv[2] ?? `iv_manual_${Date.now().toString(36)}`;
const interviewId = `manual-${Date.now().toString(36)}`;

const apiKey = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;
const url = process.env.LIVEKIT_URL;
if (!apiKey || !apiSecret || !url) {
  console.error("missing LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET");
  process.exit(1);
}

const token = new AccessToken(apiKey, apiSecret, {
  identity: "candidate_manual",
  name: "Manual Tester",
  ttl: "30m",
  attributes: {
    interviewId,
    categoryId: "salesforce_dev",
    difficulty: "intermediate",
    durationS: "900",
  },
});
token.addGrant({
  roomJoin: true,
  room,
  canPublish: true,
  canSubscribe: true,
  canPublishData: false,
});

console.log(`\nurl:   ${url}`);
console.log(`room:  ${room}`);
console.log(`\ntoken:\n${await token.toJwt()}\n`);
}

void main();
