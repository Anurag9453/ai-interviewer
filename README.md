# AI Interviewer

Practice technical interviews by voice with an AI interviewer that probes
incomplete answers, adapts difficulty, and produces a rubric-graded report.

**MVP scope:** Salesforce Developer · Intermediate · 15 minutes.

## Layout

    apps/web           Next.js 15 (App Router) → Vercel
                       auth, config, interview shell, reports, history
    apps/voice-agent   Long-lived Node process → Fly.io
                       WebRTC media session, STT/LLM/TTS, state machine,
                       report generation
    packages/core      Shared: provider abstraction, plan + evaluation
                       schemas, deterministic scoring, prompts
    supabase/          SQL migrations (schema, RLS, privileges, catalogue)

Two deployables, not microservices. The split is forced: a 15-minute voice
session needs a stateful long-lived connection, which Vercel's request-scoped
functions cannot hold.

## Provider abstraction

The interview engine talks only to `LlmProvider` in
`packages/core/src/providers/types.ts`. Swapping providers means adding one
adapter and a case in `createProvider()`; the state machine, scoring, and
prompts are untouched. `AI_PROVIDER` selects it at runtime.

Per-turn interview state is passed as an opaque `stateBlock` string, so each
adapter decides how to deliver operator instructions — the Anthropic adapter
uses a mid-conversation system message, which preserves the cached prefix.

## Setup

    pnpm install
    cp .env.example .env.local        # fill in, then mirror to apps/voice-agent

Database (no Docker here, so we run against a hosted project):

    supabase link --project-ref <ref>
    supabase db push
    pnpm db:types                     # regenerate typed DB bindings

Dev:

    pnpm dev:web                      # http://localhost:3000
    pnpm dev:agent                     # http://localhost:8080/health

Verify:

    pnpm typecheck
    curl localhost:3000/api/health     # 200 when all env present, else 503
    curl localhost:8080/health

## Deploy

**web** → Vercel. Root directory `apps/web`, build `pnpm --filter @ai/web build`.
Set every non-`NEXT_PUBLIC_` var as an encrypted environment variable.

**voice-agent** → Fly. The Dockerfile copies from the repo root, so build from
the root with an explicit config path:

    fly deploy -c apps/voice-agent/fly.toml --dockerfile apps/voice-agent/Dockerfile
    fly secrets set ANTHROPIC_API_KEY=… DEEPGRAM_API_KEY=… CARTESIA_API_KEY=… …

`auto_stop_machines` is off deliberately — never scale a machine to zero
underneath a live interview.

## Security model

* RLS is on for every table. Clients get `SELECT` only, on their own rows.
  There are no client `INSERT`/`UPDATE`/`DELETE` policies; all writes go
  through the server or the agent with the service role.
* `question_pool`, `rubric_anchors`, and `interview_plans` are **not** exposed
  to clients. They contain `must_hear` signals and scoring bands — readable
  from the browser, they let a candidate game every score.
* `answer_evaluations` is readable only once the interview is complete, so
  live signal state can't be inspected mid-interview.
* `getClaims()` is the only sanctioned way to make an auth decision on the
  server. `getSession()` does not revalidate the token.
* The voice agent bypasses RLS by design (hot-path writes need a direct
  connection), so its queries must scope by `interview_id` explicitly.

## Milestones

* [x] **M0** monorepo, schema + RLS, auth, both apps build and probe green
* [ ] **M1** Salesforce topics + rubric anchors, plan generator + validator
* [ ] **M2** bare voice loop — *go/no-go: does it feel like a real interview?*
* [ ] **M3** state machine: signals, probes, silence ladder, persistence
* [ ] **M4** report generation and UI
* [ ] **M5** interview screen polish, mic pre-flight, history
* [ ] **M6** failure handling, cost caps
