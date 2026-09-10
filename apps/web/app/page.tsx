import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buttonClass, Card, Eyebrow } from "@/components/ui";
import { PublicFooter } from "@/components/PublicFooter";

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
      <main className="mx-auto max-w-5xl px-5 pb-4 pt-14 sm:px-6 sm:pt-20">
      <section className="mx-auto max-w-2xl text-center animate-rise">
        <Eyebrow>Voice mock interviews</Eyebrow>
        <h1 className="mt-3 text-[34px] font-semibold leading-[1.1] sm:text-5xl">
          Practise interviews out loud, not on a keyboard.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-[var(--color-muted)] sm:text-base">
          A real-time AI interviewer asks you one question at a time, listens to your
          answer, follows up on what you actually said, and scores you on the things
          interviewers care about.
        </p>
        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/login" className={`${buttonClass.primary} w-full px-5 py-3 sm:w-auto`}>
            Start a free interview
          </Link>
          <Link href="/login" className={`${buttonClass.secondary} w-full px-5 py-3 sm:w-auto`}>
            Sign in
          </Link>
        </div>
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          Two interviews free · no card required
        </p>
      </section>

      <section aria-labelledby="ways" className="mt-16 sm:mt-20">
        <h2 id="ways" className="text-center text-sm font-medium text-[var(--color-muted)]">
          Three ways to practise
        </h2>
        <ul className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            {
              title: "A standard interview",
              body: "Pick a field and difficulty. Questions are drawn from a real question bank and adapt as you answer.",
            },
            {
              title: "Based on your resume",
              body: "Upload your resume and get grilled on your own roles, projects and claims — the way a real interviewer would.",
            },
            {
              title: "From your own material",
              body: "Upload notes, a spec or a paper, and be interviewed on that specific content.",
            },
          ].map((w) => (
            <Card key={w.title} as="li" className="p-5">
              <p className="text-sm font-semibold">{w.title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted)]">{w.body}</p>
            </Card>
          ))}
        </ul>
      </section>

      <section aria-labelledby="how" className="mx-auto mt-16 max-w-2xl sm:mt-20">
        <h2 id="how" className="text-center text-sm font-medium text-[var(--color-muted)]">
          How a session goes
        </h2>
        <ol className="mt-5 space-y-2.5">
          {[
            ["Quick mic check", "You confirm your microphone works before anything starts."],
            ["You talk, it listens", "No typing. The interviewer waits, and nudges you if you go quiet."],
            ["It follows up", "Vague answers get probed — the same way a real interviewer digs in."],
            ["You get a report", "Scored by dimension, with the specific things you left unsaid."],
          ].map(([title, body], i) => (
            <li key={title} className="flex gap-3.5 rounded-[var(--radius-card)] bg-[var(--color-sunken)] px-4 py-3.5">
              <span
                aria-hidden
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-ink)] text-[11px] font-semibold text-white"
              >
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-medium">{title}</p>
                <p className="text-sm leading-relaxed text-[var(--color-muted)]">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-16 text-center sm:mt-20">
        <Link href="/login" className={`${buttonClass.solid} px-5 py-3`}>
          Continue with Google
        </Link>
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          Your resume and uploads stay private to your account.
        </p>
      </section>
      </main>
      <PublicFooter />
    </>
  );
}
