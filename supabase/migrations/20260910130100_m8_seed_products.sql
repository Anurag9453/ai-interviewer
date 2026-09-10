-- Illustrative placeholder pricing — a real business/pricing decision is
-- explicitly out of this milestone's scope. price_cents is the smallest
-- currency unit (paise for INR, matching the generic column name so the
-- same schema works for a future non-INR currency without a rename).
insert into public.billing_products (id, name, kind, interview_quantity, price_cents, currency, billing_interval, active, sort, description)
values
  ('sub_monthly_10', 'Monthly — 10 interviews', 'subscription', 10, 99900, 'INR', 'month', true, 10,
   '10 mock interviews per month, renews automatically.'),
  ('topup_5', 'Top-up — 5 interviews', 'topup', 5, 59900, 'INR', null, true, 20,
   '5 additional interviews, added to your current balance.'),
  ('topup_10', 'Top-up — 10 interviews (discounted)', 'topup', 10, 99900, 'INR', null, true, 30,
   '10 additional interviews at a lower per-interview price than the 5-pack.')
on conflict (id) do update set
  name = excluded.name, interview_quantity = excluded.interview_quantity,
  price_cents = excluded.price_cents, currency = excluded.currency,
  billing_interval = excluded.billing_interval, description = excluded.description;
