# First production deployment checklist

Nothing is deployed yet. Every variable list below was read out of the code
that consumes it, not assumed.

**Rule: no development or test credential goes into production.** The one
deliberate exception is Razorpay, which stays in **Test Mode** for beta —
live-mode payments are explicitly not being enabled.

## Blocked on you (I cannot do these)

| Step | Why I can't |
|---|---|
| `vercel login` | interactive browser auth |
| `flyctl` install + `fly auth login` | not installed; interactive auth |
| First git commit + remote | repo has zero commits on `master`, no remote |
| Google Cloud Console redirect URI | your Google account |
| Supabase dashboard redirect allow-list | your Supabase project settings |
| Razorpay dashboard webhook | your Razorpay account |

## 1. Web (Vercel)

**Monorepo settings** — this is a pnpm workspace and `apps/web` depends on
`@ai/core` via `workspace:*`:

- Root Directory: `apps/web`
- Framework preset: Next.js
- Install command must run from the repo root so the workspace resolves

**Environment variables** (from `apps/web` code):

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public, reaches the browser |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public, reaches the browser |
| `NEXT_PUBLIC_LIVEKIT_URL` | public, reaches the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** — bypasses RLS entirely |
| `ANTHROPIC_API_KEY` | **secret** |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | **secret** |
| `RAZORPAY_KEY_ID` | sent to the browser for Checkout.js (publishable by design) |
| `RAZORPAY_KEY_SECRET` | **secret** |
| `RAZORPAY_WEBHOOK_SECRET` | **secret** — currently a local placeholder, must be the real dashboard value |
| `NEXT_PUBLIC_E2E_MOCK` | **must stay unset** — setting it makes `/interview` a public route |

`/api/health` distinguishes these: the first seven gate `ok` and return 503
when missing; the Razorpay three report as `degraded: ["billing"]` with a 200.

**Function duration:** `documents/[id]/analyze` and `documents/[id]/generate`
export `maxDuration = 60` (Hobby ceiling). `generate` makes two thorough
Claude calls (4k + 16k output tokens) — on Pro, raise it toward 300, or a
timeout will skip the compensating cleanup and orphan rows.

## 2. Domain + Google OAuth (production)

The callback path is `/auth/callback` (`apps/web/app/auth/callback/route.ts`),
which already prefers the forwarded host behind a proxy, so it works on a real
domain without code changes.

1. Add the production domain in Vercel.
2. **Supabase** → Authentication → URL Configuration:
   - Site URL: `https://<domain>`
   - Redirect allow-list: `https://<domain>/auth/callback` and
     `https://<domain>/auth/confirm`
3. **Google Cloud Console** → OAuth client → Authorized redirect URIs: the
   Supabase callback (`https://<project>.supabase.co/auth/v1/callback`) — Google
   redirects to Supabase, which then redirects to `/auth/callback`.
4. Consider setting a configured site URL for the magic-link fallback in
   `app/login/actions.ts:20`, which currently falls back to
   `http://localhost:3000` if the `Origin` header is ever absent.

## 3. Voice agent (Fly.io)

`apps/voice-agent/fly.toml` and `Dockerfile` already exist:
app `ai-interviewer-voice`, region `sin`, `shared-cpu-2x` / 2GB,
`auto_stop_machines = false`, `min_machines_running = 1` (a voice session is a
long-lived stateful connection — never scale to zero underneath one), and a
`/health` check every 15s.

**Fixed during this pass:** the Dockerfile `CMD` ran `start`
(`src/index.ts`), which is the M0 health-only boot check — it serves `/health`
and nothing else. A container running it passes Fly's check and holds a
machine while **never registering with LiveKit or accepting an interview**. Now
runs `start:worker` (`src/worker.ts`), the real pipeline, which serves the same
`/health` on the same port and delegates job dispatch, drain and shutdown to
LiveKit's `cli.runApp`.

**Secrets** (`fly secrets set …`) — `env.ts` validates these at boot and
refuses to start if any is missing, by design:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | direct Postgres; required since M6.1 for plan loading + evidence + lifecycle |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | production LiveKit project |
| `DEEPGRAM_API_KEY` | STT |
| `CARTESIA_API_KEY` | TTS |
| `ANTHROPIC_API_KEY` | required when `AI_PROVIDER=anthropic` (the default) |
| `PORT` | defaults to 8080, matches `fly.toml` |
| `AI_PROVIDER` | leave `anthropic`; **do not ship `bedrock`** — its pricing table is a labelled placeholder, so every cost figure would be wrong |

Both web and agent must point at the **same** Supabase project, or webhook
grants and interview evidence land in different databases.

## 4. Database

Migrations are applied as raw SQL in this project (no
`supabase_migrations.schema_migrations` table exists). Before beta, confirm the
production database has every file in `supabase/migrations/` applied, including
the two most recent: `20260910140000_m10_resume_documents.sql` and
`20260910150000_m10_generated_plan_index.sql`.

## 5. Razorpay (Test Mode) — after the web deployment exists

1. Register `https://<domain>/api/billing/webhook`.
2. Set the secret you choose there as `RAZORPAY_WEBHOOK_SECRET` in Vercel,
   replacing the placeholder.
3. Subscribe to exactly these 8 events:
   `payment.captured`, `payment.failed`, `subscription.charged`,
   `subscription.cancelled`, `subscription.completed`, `subscription.halted`,
   `refund.processed`, `payment.dispute.created`.
4. `billing_products.provider_plan_id` for `sub_monthly_10` is already set to
   `plan_TaMAkhdjVKP5ht` — verify it exists in the production-facing Test Mode
   account before testing.
5. A fresh purchase is required: Razorpay only retains/redelivers events fired
   while an endpoint was registered, so the earlier test payment cannot be
   replayed.
