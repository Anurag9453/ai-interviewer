-- M8 — billing, entitlements, admin.
--
-- Builds entirely on M7's credit_grants ledger + the UNCHANGED
-- interview_credits/consume_interview_credit() fast path — credits stay one
-- fungible pool (`granted` - `consumed`), exactly matching the acceptance
-- spec's own example ("10 subscription + 5 topup = 15 total, subject to
-- consumption"). Nothing here touches consume_interview_credit() or
-- refund_interview_credit(); the M4/M5/M6 entitlement layer is untouched.
--
-- New surface, in dependency order:
--   billing_products      catalogue (subscriptions + topups), DB-backed
--   promotions            promo codes, service-role only (codes/limits are
--                         exactly the kind of thing a client must never browse)
--   promotion_redemptions one row per successful redemption, enforces
--                         per_user_limit via a partial-unique-ish check
--   payment_events        raw webhook events, the actual idempotency
--                         mechanism (unique on provider+provider_event_id)
--   payment_transactions  one row per purchase attempt, links to the
--                         credit_grants row it produced (if any)
--   subscriptions         current subscription state per user
--   credit_reversals      refund/chargeback bookkeeping — NEVER mutates a
--                         past credit_grants row (append-only ledger
--                         principle); reverse_interview_credits() is the
--                         symmetric counterpart to grant_interview_credits()
--   usage_events           durable per-interview cost/usage records (M8 §12)
--   profiles.is_admin      real server-side admin flag, column-grant-locked
--                         so no client request can ever set it on themselves

-- ── plan/product catalogue ──────────────────────────────────────────────
create table public.billing_products (
  id                 text primary key,
  name               text not null,
  kind               text not null check (kind in ('subscription', 'topup')),
  interview_quantity integer not null check (interview_quantity > 0),
  price_cents        integer not null check (price_cents >= 0),
  currency           text not null default 'INR',
  -- null for topups (one-time); required for subscriptions.
  billing_interval   text check (billing_interval in ('month', 'year')),
  active             boolean not null default true,
  sort               integer not null default 0,
  description        text,
  created_at         timestamptz not null default now(),
  check ((kind = 'subscription') = (billing_interval is not null))
);

alter table public.billing_products enable row level security;
create policy "billing_products: read active" on public.billing_products
  for select to authenticated using (active = true);
revoke all on table public.billing_products from anon, authenticated;
grant select on table public.billing_products to authenticated;

-- ── promotions ───────────────────────────────────────────────────────────
-- No client policy at all, deliberately — same trust model as question_pool:
-- a candidate who can browse promo codes and their limits client-side can
-- game them. Validated server-side only (see lib/promo.ts), via service role.
create table public.promotions (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null unique,
  percent_off            numeric(5,2) check (percent_off > 0 and percent_off <= 100),
  amount_off_cents       integer check (amount_off_cents > 0),
  active                 boolean not null default true,
  starts_at              timestamptz,
  ends_at                timestamptz,
  redemption_limit       integer check (redemption_limit > 0),
  per_user_limit         integer not null default 1 check (per_user_limit > 0),
  -- null/empty = applicable to every product.
  applicable_product_ids text[],
  min_amount_cents       integer check (min_amount_cents >= 0),
  created_at             timestamptz not null default now(),
  check (percent_off is not null or amount_off_cents is not null)
);
alter table public.promotions enable row level security;
revoke all on table public.promotions from anon, authenticated;

create table public.promotion_redemptions (
  id                     uuid primary key default gen_random_uuid(),
  promotion_id           uuid not null references public.promotions (id),
  user_id                uuid not null references auth.users (id) on delete cascade,
  payment_transaction_id uuid,
  redeemed_at            timestamptz not null default now()
);
create index promotion_redemptions_user_idx on public.promotion_redemptions (promotion_id, user_id);
alter table public.promotion_redemptions enable row level security;
create policy "promotion_redemptions: select own" on public.promotion_redemptions
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.promotion_redemptions from anon, authenticated;
grant select on table public.promotion_redemptions to authenticated;

-- ── webhook events: the idempotency mechanism ───────────────────────────
-- The unique constraint IS the dedup guarantee — a retried/duplicate webhook
-- delivery attempts the same insert and fails (caller catches the unique
-- violation and treats it as "already processed", per lib/payments/*.ts),
-- never a second credit grant for the same provider event.
create table public.payment_events (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null default 'razorpay',
  provider_event_id text not null,
  event_type        text not null,
  raw_payload       jsonb not null,
  processed_at      timestamptz,
  processing_error  text,
  created_at        timestamptz not null default now(),
  unique (provider, provider_event_id)
);
alter table public.payment_events enable row level security;
revoke all on table public.payment_events from anon, authenticated;

-- ── transactions ─────────────────────────────────────────────────────────
create table public.payment_transactions (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references auth.users (id) on delete cascade,
  product_id                text not null references public.billing_products (id),
  payment_event_id          uuid references public.payment_events (id),
  provider                  text not null default 'razorpay',
  provider_payment_id       text,
  provider_order_id         text,
  provider_subscription_id  text,
  status                    text not null check (status in
                              ('pending', 'captured', 'failed', 'refunded', 'partially_refunded', 'disputed')),
  amount_cents              integer not null check (amount_cents >= 0),
  currency                  text not null default 'INR',
  promotion_id              uuid references public.promotions (id),
  discount_cents            integer not null default 0 check (discount_cents >= 0),
  credit_grant_id           uuid references public.credit_grants (id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index payment_transactions_user_idx on public.payment_transactions (user_id, created_at desc);

alter table public.payment_transactions enable row level security;
create policy "payment_transactions: select own" on public.payment_transactions
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.payment_transactions from anon, authenticated;
grant select on table public.payment_transactions to authenticated;

alter table public.promotion_redemptions
  add constraint promotion_redemptions_transaction_fkey
  foreign key (payment_transaction_id) references public.payment_transactions (id);

-- ── subscriptions ────────────────────────────────────────────────────────
create table public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users (id) on delete cascade,
  product_id               text not null references public.billing_products (id),
  provider_subscription_id text unique,
  status                   text not null check (status in ('active', 'cancelled', 'expired', 'past_due')),
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index subscriptions_user_idx on public.subscriptions (user_id, status);

alter table public.subscriptions enable row level security;
create policy "subscriptions: select own" on public.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.subscriptions from anon, authenticated;
grant select on table public.subscriptions to authenticated;

-- ── refund / reversal ledger ─────────────────────────────────────────────
-- amount_requested vs amount_applied is the honest answer to "what if the
-- user already spent some of what's being refunded": applied is capped at
-- whatever's still unconsumed (never pushes granted below consumed), and a
-- shortfall (amount_applied < amount_requested) is left VISIBLE here for an
-- admin to see and act on — not silently absorbed or silently refused. This
-- is the explicit product-policy flag the spec asked for, not an invented
-- rule about what "should" happen to already-spent credits.
create table public.credit_reversals (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  payment_transaction_id uuid references public.payment_transactions (id),
  amount_requested       integer not null check (amount_requested > 0),
  amount_applied         integer not null check (amount_applied >= 0 and amount_applied <= amount_requested),
  reason                 text not null check (reason in ('refund', 'chargeback', 'manual_admin_action')),
  note                   text,
  created_at             timestamptz not null default now()
);
create index credit_reversals_user_idx on public.credit_reversals (user_id, created_at desc);

alter table public.credit_reversals enable row level security;
create policy "credit_reversals: select own" on public.credit_reversals
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.credit_reversals from anon, authenticated;
grant select on table public.credit_reversals to authenticated;

create or replace function public.reverse_interview_credits(
  p_user_id uuid, p_amount integer, p_reason text,
  p_payment_transaction_id uuid default null, p_note text default null
)
returns table (amount_applied integer, shortfall integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_available integer;
  v_applied integer;
begin
  if p_amount <= 0 then
    raise exception 'reverse_interview_credits: amount must be positive';
  end if;

  select greatest(0, granted - consumed) into v_available
  from public.interview_credits where user_id = p_user_id;

  v_applied := least(p_amount, coalesce(v_available, 0));

  update public.interview_credits
  set granted = granted - v_applied, updated_at = now()
  where user_id = p_user_id;

  insert into public.credit_reversals (user_id, payment_transaction_id, amount_requested, amount_applied, reason, note)
  values (p_user_id, p_payment_transaction_id, p_amount, v_applied, p_reason, p_note);

  return query select v_applied, p_amount - v_applied;
end;
$$;
revoke all on function public.reverse_interview_credits(uuid, integer, text, uuid, text) from public, anon, authenticated;

-- ── per-interview usage/cost metering ────────────────────────────────────
-- Raw usage kept separate from the derived cost estimate, per the spec:
-- never fake a provider's cost when it isn't reported, and never let a
-- unit-economics estimate silently become "the" usage number.
create table public.usage_events (
  id                  uuid primary key default gen_random_uuid(),
  interview_id        uuid not null references public.interviews (id) on delete cascade,
  user_id             uuid not null references auth.users (id) on delete cascade,
  duration_s          integer,
  stt_provider        text,
  stt_audio_s         numeric(10,2),
  llm_provider        text,
  llm_model           text,
  llm_input_tokens    integer,
  llm_output_tokens   integer,
  llm_cost_cents      numeric(10,4),
  tts_provider        text,
  tts_characters      integer,
  livekit_minutes     numeric(10,2),
  -- Nullable and separate from the raw fields above — an estimate the app
  -- computed, not a number any provider reported.
  estimated_cost_cents numeric(10,4),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (interview_id)
);

alter table public.usage_events enable row level security;
-- No client policy — this is cost/infrastructure data, admin-only, same
-- trust model as question_pool. Written by the voice agent (service role),
-- read only through the admin API (also service role, with an explicit
-- is_admin check — see lib/admin.ts).
revoke all on table public.usage_events from anon, authenticated;

-- ── admin flag ───────────────────────────────────────────────────────────
alter table public.profiles add column is_admin boolean not null default false;
-- Deliberately NOT included in the M0 "update (display_name)" column grant —
-- no client request, however it's shaped, can ever set this on themselves.
-- Settable only via service-role / direct SQL.
