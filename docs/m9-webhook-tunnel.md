# Local webhook tunnel setup

Razorpay needs to reach `POST /api/billing/webhook` on a public URL — it
cannot deliver to `localhost`.

## cloudflared quick tunnels: tried and rejected

`cloudflared` (2026.9.0) is installed via Homebrew and its tunnels register
successfully with Cloudflare's edge, but **the quick-tunnel hostnames never
resolve in DNS on this setup**. Verified properly rather than assumed:

- `cloudflared_tunnel_ha_connections 1` — tunnel connected (edge `bom06`)
- `cloudflared_tunnel_total_requests 0` — nothing ever arrived through it
- Querying Cloudflare's own authoritative nameservers over DNS-over-HTTPS
  (bypassing the local resolver entirely) returned `"Status":3` — NXDOMAIN,
  with an authoritative SOA from `kevin.ns.cloudflare.com`. Cloudflare itself
  says the hostname does not exist.
- `trycloudflare.com` apex resolves fine, so DNS generally works. Two
  separate tunnel attempts both failed the same way, across ~50s of polling.

Quick tunnels are free and explicitly best-effort — `cloudflared`'s own
startup banner says they have "no uptime guarantee". Don't rely on them here.

## Use ngrok instead

```bash
# one-time: sign up free at ngrok.com and copy the authtoken
brew install ngrok
ngrok config add-authtoken <token>

# each session
ngrok http 3000
```

Public URL shape: `https://<random>.ngrok-free.app`, so the webhook URL to
register is `https://<random>.ngrok-free.app/api/billing/webhook`.

The free tier's URL changes every restart, so the Razorpay dashboard webhook
URL must be updated whenever the tunnel restarts.

Other options if ngrok becomes a problem: VS Code's built-in port forwarding
(gives a `*.devtunnels.ms` URL via a GitHub/Microsoft login, no install), or
a Vercel preview deployment with a stable URL — closest to production and
avoids tunnels entirely.

## Copying the URL safely

Read it from a log rather than the terminal's ASCII box — a clipped hostname
produced a confusing NXDOMAIN during setup that looked like a DNS failure but
was really a truncated last word:

```bash
ngrok http 3000 --log=stdout | tee /tmp/ngrok.log
grep -oE 'https://[a-z0-9-]+\.ngrok-free\.app' /tmp/ngrok.log
```

## What you can verify without any tunnel

`apps/web/_verify-webhook-local.ts` exercises the whole server-side path
against the real database — middleware pass-through, route, signature
verification, event-id/idempotency, `processWebhookEvent`,
`SupabaseBillingStore`, and the `grant_interview_credits` RPC — by signing a
payload with the same HMAC-SHA256 scheme Razorpay uses and POSTing it to the
local dev server.

```bash
cd apps/web && node --env-file=.env.local --import tsx _verify-webhook-local.ts
```

It seeds a pending transaction, asserts the grant/idempotency behaviour, then
deletes every row it created and restores the credit balance to baseline.

This is **not** a Razorpay sandbox test and must never be reported as one. It
proves our code is correct; it proves nothing about whether Razorpay can
reach us, whether its real payload shape matches, or whether it actually
sends the `x-razorpay-event-id` header. Only a real Test Mode delivery
proves those.
