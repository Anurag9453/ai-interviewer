# M9 Razorpay Test Mode — test data log

Record of Razorpay Test Mode objects created during M9 verification and what
happened to them. Test Mode only; no live-mode object has ever been created.

## 2026-09-10 — initial checkout test (pre-webhook)

**Purpose:** prove the outbound half of the flow (checkout → real Razorpay
subscription → real card payment) before any webhook endpoint existed.

| Object | Id | Final state |
|---|---|---|
| Plan | `plan_TaMAkhdjVKP5ht` | kept — monthly, ₹999 (99900 INR subunits), stored in `billing_products.provider_plan_id` for `sub_monthly_10` |
| Subscription | `sub_TaME5zYd1PUrMz` | **cancelled** 2026-09-10 (`cancel_at_cycle_end: false`, `ended_at` 1789048911, 11 cycles dropped) |
| Payment | `pay_TaMIdFuZLiunb2` | captured, ₹999, card, invoice `inv_TaME6U9WwkvKNC` — left as-is on the account |
| Our transaction row | `25860576-cc47-4072-9cf4-54e217f4a0bb` | **deleted** 2026-09-10 |

**Subscription notes payload** (proves credit attribution plumbing):
`{"userId":"32756d8c-2016-4fb2-8ea3-a6d0ab85aa49","productId":"sub_monthly_10","transactionId":"25860576-cc47-4072-9cf4-54e217f4a0bb"}`

### Why the transaction was never completed

**No webhook endpoint was registered on the Razorpay account at the time**
(verified: `GET /v1/webhooks` returned `count: 0`). The payment succeeded and
the subscription went `active` / `paid 1/12` on Razorpay's side, but
`subscription.charged` and `payment.captured` were never delivered to us, so:

- `payment_transactions.status` stayed `pending`
- no `payment_events` row was created
- no credits were granted (correct — credits are only ever granted by a
  signature-verified webhook)

The row was therefore an orphan that could never resolve. It was deleted
rather than marked `failed`, because `failed` would be factually wrong — the
payment genuinely succeeded at the provider. The `status` check constraint
offers no `cancelled`/`abandoned` value and the table has no note column,
which is why this file is the history record.

**Important:** Razorpay only retains and allows redelivery of events fired
while an endpoint is registered. These events were never queued for anyone
and cannot be replayed — the inbound path requires a *fresh* payment made
after the webhook is configured.

### Deletion scope

Only the single transaction row above was deleted. Verified before/after:

```
BEFORE: txns=1 events=0 grants=2 subs=0 credits=0e5bc1be:2/1 32756d8c:2/2
AFTER : txns=0 events=0 grants=2 subs=0 credits=0e5bc1be:2/1 32756d8c:2/2
```

Both `free_trial` credit grants and both users' balances were preserved
untouched. The `plan_TaMAkhdjVKP5ht` plan and its
`billing_products.provider_plan_id` link were deliberately kept — the plan is
still the correct backing object for `sub_monthly_10`, and Razorpay plans
cannot be deleted anyway.
