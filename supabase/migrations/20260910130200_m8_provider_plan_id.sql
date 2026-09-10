-- Razorpay subscriptions reference a pre-created Plan entity (razorpay.plans.create,
-- done once via dashboard/API, out of this app's runtime) by plan_id — a raw amount
-- is not enough to create a subscription the way it is for a one-time order/topup.
alter table public.billing_products add column provider_plan_id text;
