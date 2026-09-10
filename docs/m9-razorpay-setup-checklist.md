# M9 — Razorpay Test Mode setup checklist

Everything in this document is prep only. No Razorpay API call has been made
from this codebase yet — nothing here has been verified against a real
Razorpay account. This is the exact list of manual steps and values needed
before the real acceptance flow (checkout → Razorpay sandbox → webhook →
signature verification → payment event → credit grant) can run.

## 1. Values you need to obtain from the Razorpay Dashboard (Test Mode)

| Value | Where it comes from | Where it's consumed in code |
|---|---|---|
| `RAZORPAY_KEY_ID` | Dashboard → Settings → API Keys → Generate Test Key | `checkout/route.ts` only (order/subscription creation); also returned to the browser as `keyId` for Checkout.js — this one is meant to be public |
| `RAZORPAY_KEY_SECRET` | Same screen, shown once at generation | `checkout/route.ts` only — server-only, never returned to the client |
| `RAZORPAY_WEBHOOK_SECRET` | Dashboard → Settings → Webhooks → (create the webhook first, see §2) → the secret you set when creating it | `webhook/route.ts` — used as the HMAC key for signature verification |
| Razorpay subscription `plan_id` for `sub_monthly_10` | Dashboard → Subscriptions → Plans → create a plan matching ₹999/month | Stored in `billing_products.provider_plan_id`, see §3 |

All three env vars go in `apps/web/.env.local` (never committed). No other
file needs them — confirmed in the M9-prep secret-exposure audit that only
`RAZORPAY_KEY_ID` (the publishable one) ever reaches client code.

## 2. Webhook configuration in the Razorpay Dashboard

- **URL to register**: `<tunnel-url>/api/billing/webhook`
  (e.g. `https://<random>.ngrok-free.app/api/billing/webhook` while testing
  locally — see `docs/m9-webhook-tunnel.md`; Cloudflare quick tunnels were
  tried and don't resolve on this setup). In production this becomes the real
  deployed domain's `/api/billing/webhook`.
- **Mode**: Test Mode webhook (Razorpay's dashboard keeps Test and Live
  webhook URLs/secrets separate — confirm you're creating this under the
  Test Mode toggle, not Live).
- **Secret**: you choose this value when creating the webhook in the
  dashboard; it becomes `RAZORPAY_WEBHOOK_SECRET` above. Razorpay does not
  generate it for you.
- **Active events to subscribe to** — exactly these 8, matching every case
  `apps/web/lib/billing-webhook.ts` actually handles (confirmed by reading
  its `switch` statement this session; subscribing to more just means extra
  events arrive that fall through to the `default: ignored` case, subscribing
  to fewer means a real payment event silently never reaches this app):
  1. `payment.captured`
  2. `payment.failed`
  3. `subscription.charged`
  4. `subscription.cancelled`
  5. `subscription.completed`
  6. `subscription.halted`
  7. `refund.processed`
  8. `payment.dispute.created`

## 3. Storing the subscription plan id

Once the Test Mode plan for `sub_monthly_10` is created in the dashboard and
you have its `plan_id` (looks like `plan_XXXXXXXXXXXXXX`):

```sql
update public.billing_products
set provider_plan_id = 'plan_XXXXXXXXXXXXXX'  -- replace with the real Test Mode plan id
where id = 'sub_monthly_10';
```

Run this via the Supabase SQL editor or `supabase db query` against the
project's database. `topup_5` / `topup_10` need no `provider_plan_id` — they
go through `provider.createOrder()` (one-off orders), not Razorpay Plans;
only subscription-kind products use this column
(`apps/web/app/api/billing/checkout/route.ts` only reads
`product.provider_plan_id` on the `product.kind !== "topup"` branch).

## 4. What happens when you provide the credentials

Once `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
and the `sub_monthly_10` plan id are in place, the real acceptance flow can
run end to end:

checkout → Razorpay sandbox → webhook delivery → signature verification →
`processWebhookEvent` → credit grant → verified in `billing_products`'
purchase history / admin overview.

The one thing to check on the very first real webhook delivery specifically:
whether Razorpay actually sends an `x-razorpay-event-id` header. The code
already handles its absence safely (falls back to a SHA-256 hash of the raw
body for idempotency — see `apps/web/app/api/billing/webhook/route.ts`), but
the header's existence was only third-party-confirmed, not found in
Razorpay's own first-party docs during this session's review.
