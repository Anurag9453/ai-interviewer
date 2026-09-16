import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buttonClass, Card, Eyebrow } from "@/components/ui";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { VoiceOrb } from "@/components/VoiceOrb";

/**
 * Next uses thrown errors for control flow, tagged with a `digest`. These must
 * always propagate: catching them turns a working framework mechanism into a
 * silent failure. Matched by prefix because NEXT_REDIRECT carries a suffix.
 */
const NEXT_CONTROL_FLOW_DIGESTS = ["NEXT_REDIRECT", "NEXT_NOT_FOUND", "DYNAMIC_SERVER_USAGE"];

function isNextControlFlow(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  if ("digest" in err && typeof err.digest === "string") {
    if (NEXT_CONTROL_FLOW_DIGESTS.some((d) => err.digest === d || (err.digest as string).startsWith(`${d};`))) {
      return true;
    }
  }
  // DynamicServerError isn't always digest-tagged depending on where it's raised.
  return err instanceof Error && err.constructor.name === "DynamicServerError";
}

/**
 * Landing page. Its whole job is to make a first-time visitor understand
 * three things before they scroll: it's a spoken interview, an AI asks and
 * follows up, and you get scored. Signed-in visitors never see it.
 */
export default async function Home() {
  // The signed-in redirect is a convenience, not a requirement for this page
  // to be useful — so it must never be able to break the one page a first-time
  // visitor sees. A deployment with Supabase env vars missing previously threw
  // here (createClient asserts both with `!`) and served a 500 "Application
  // error" on the marketing homepage, while protected routes correctly showed
  // a 503. The landing page now degrades to simply not redirecting.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    try {
      const supabase = await createClient();
      const { data: claims } = await supabase.auth.getClaims();
      if (claims?.claims?.sub) redirect("/dashboard");
    } catch (err) {
      // Next signals control flow through thrown errors, and swallowing any of
      // them breaks the framework rather than protecting the page:
      //   NEXT_REDIRECT        — the redirect() above; swallowing it stops
      //                          signed-in users being sent to the dashboard.
      //   DYNAMIC_SERVER_USAGE — cookies() telling Next this route can't be
      //                          statically prerendered; swallowing it would
      //                          let / be cached as static HTML, so the
      //                          per-request auth check would never run.
      // Only a genuine failure (e.g. bad Supabase config) falls through.
      if (isNextControlFlow(err)) throw err;
      console.error("landing page auth check failed; rendering the public page", err);
    }
  }

  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-5 pb-4 pt-10 sm:px-6 sm:pt-16">
        <section className="grid items-center gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-8">
          <div className="animate-rise">
            <Eyebrow>Voice mock interviews</Eyebrow>
            <h1 className="font-display mt-4 text-[42px] leading-[1.05] text-balance sm:text-6xl lg:text-[68px]">
              Practise interviews out loud, not on a keyboard.
            </h1>
            <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-[var(--color-muted)] sm:text-lg">
              A real-time AI interviewer asks you one question at a time, listens to your
              answer, follows up on what you actually said, and scores you on the things
              interviewers care about.
            </p>
            <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <Link href="/login" className={`${buttonClass.primary} px-6 py-3.5 text-[15px]`}>
                Start a free interview
              </Link>
              <Link href="/login" className={`${buttonClass.secondary} px-6 py-3.5 text-[15px]`}>
                Sign in
              </Link>
            </div>
            <p className="mt-3 text-xs text-[var(--color-muted)]">
              Two interviews free · no card required
            </p>
          </div>

          <div className="relative mx-auto flex flex-col items-center animate-rise-delay-1 lg:mx-0 lg:justify-self-end">
            <VoiceOrb size={280} listening label="Animated interviewer presence" />
            <div className="relative z-10 -mt-8 w-[min(280px,calc(100vw-3rem))] rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-raised)]/95 p-4 shadow-[var(--shadow-lift)] backdrop-blur">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-accent-ink)]">
                Live now
              </p>
              <p className="mt-1 text-sm font-medium">“Walk me through how you’d design that.”</p>
              <p className="mt-0.5 text-xs text-[var(--color-muted)]">Listening · question 3 of 8</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="ways" className="mt-28 sm:mt-32">
          <h2 id="ways" className="text-center text-sm font-medium text-[var(--color-muted)]">
            Three ways to practise
          </h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              {
                title: "A standard interview",
                body: "Pick a field and difficulty. Questions are drawn from a real question bank and adapt as you answer.",
                kicker: "01",
              },
              {
                title: "Based on your resume",
                body: "Upload your resume and get grilled on your own roles, projects and claims — the way a real interviewer would.",
                kicker: "02",
              },
              {
                title: "From your own material",
                body: "Upload notes, a spec or a paper, and be interviewed on that specific content.",
                kicker: "03",
              },
            ].map((w, i) => (
              <Card
                key={w.title}
                as="li"
                className={`p-6 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] ${i === 1 ? "sm:translate-y-3" : ""}`}
              >
                <p className="font-display text-2xl text-[var(--color-accent-ink)]">{w.kicker}</p>
                <p className="mt-3 text-base font-semibold">{w.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">{w.body}</p>
              </Card>
            ))}
          </ul>
        </section>

        <section aria-labelledby="how" className="mx-auto mt-24 max-w-3xl sm:mt-28">
          <h2 id="how" className="text-center text-sm font-medium text-[var(--color-muted)]">
            How a session goes
          </h2>
          <ol className="relative mt-8 space-y-3 before:absolute before:top-4 before:bottom-4 before:left-[21px] before:w-px before:bg-[var(--color-line)]">
            {[
              ["Quick mic check", "You confirm your microphone works before anything starts."],
              ["You talk, it listens", "No typing. The interviewer waits, and nudges you if you go quiet."],
              ["It follows up", "Vague answers get probed — the same way a real interviewer digs in."],
              ["You get a report", "Scored by dimension, with the specific things you left unsaid."],
            ].map(([title, body], i) => (
              <li key={title} className="relative flex gap-4 rounded-[var(--radius-card)] bg-[var(--color-raised)]/70 px-4 py-4 shadow-[var(--shadow-card)]">
                <span
                  aria-hidden
                  className="relative z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-ink)] text-[11px] font-semibold text-white"
                >
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-[var(--color-muted)]">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-24 overflow-hidden rounded-[28px] bg-[var(--color-ink)] px-6 py-14 text-center text-white sm:mt-28 sm:px-10">
          <p className="font-display text-4xl leading-tight sm:text-5xl">Ready when you are.</p>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-white/65">
            Two interviews are free. See how it feels to answer out loud, under a little pressure.
          </p>
          <Link href="/login" className={`${buttonClass.primary} mt-7 px-6 py-3.5`}>
            Continue with Google
          </Link>
          <p className="mt-3 text-xs text-white/50">
            Your resume and uploads stay private to your account.
          </p>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
