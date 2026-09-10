import Link from "next/link";
import type { Metadata } from "next";
import { buttonClass, Card, Eyebrow } from "@/components/ui";
import { PublicFooter } from "@/components/PublicFooter";

export const metadata: Metadata = {
  title: "About · AI Interviewer",
  description:
    "AI Interviewer is a practice tool for interviews you actually speak out loud — adaptive questions, and a report on what you said.",
};

/**
 * Public marketing page. No auth, no data access — deliberately a pure
 * static render, so it cannot break on a misconfigured deployment the way
 * the landing page's signed-in redirect once did.
 *
 * Claims here are kept to what the product demonstrably does. No guaranteed
 * outcomes, no "human-level" or "perfect" evaluation language.
 */
export default function AboutPage() {
  return (
    <>
      <main className="mx-auto max-w-3xl px-5 pt-14 sm:px-6 sm:pt-20">
        <header className="animate-rise">
          <Eyebrow>About</Eyebrow>
          <h1 className="mt-3 text-[32px] font-semibold leading-[1.15] sm:text-4xl">
            Interview practice you do out loud.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-[var(--color-muted)] sm:text-base">
            We help people practise interviews in a realistic, interactive environment so they can
            improve through repeated practice. You speak, an AI interviewer listens and follows up,
            and afterwards you get a breakdown of what you actually said.
          </p>
        </header>

        <section aria-labelledby="problem" className="mt-12">
          <h2 id="problem" className="text-lg font-semibold">The problem</h2>
          <p className="mt-2.5 text-[15px] leading-relaxed text-[var(--color-muted)]">
            Most interview preparation is silent and solitary. You read questions, think through an
            answer in your head, and conclude you know it. Then the real interview arrives and you
            have to say it out loud, in order, under time pressure, to someone who interrupts and asks
            &ldquo;why?&rdquo; — and that turns out to be a completely different skill.
          </p>
          <p className="mt-3 text-[15px] leading-relaxed text-[var(--color-muted)]">
            Practising with another person fixes that, but it needs someone available, willing, and
            knowledgeable enough to push back. Most people can&rsquo;t arrange that on a Tuesday night.
          </p>
        </section>

        <section aria-labelledby="how" className="mt-12">
          <h2 id="how" className="text-lg font-semibold">How it works</h2>
          <p className="mt-2.5 text-[15px] leading-relaxed text-[var(--color-muted)]">
            An interview runs as a live voice conversation. There&rsquo;s no chat box and nothing to
            type — you talk, and the interviewer responds.
          </p>
          <ol className="mt-5 space-y-2.5">
            {[
              ["A quick microphone check", "You confirm your mic works before anything begins."],
              [
                "One question at a time",
                "Questions come from a prepared set for your chosen subject, and the interviewer decides what to ask next based on how you've answered so far.",
              ],
              [
                "Follow-ups on your actual answer",
                "If an answer is vague or skips something important, you get probed on that specific point rather than moved along.",
              ],
              [
                "You can interrupt, and so can it",
                "It's a spoken conversation — you can cut in mid-question, and the interviewer will stop and listen.",
              ],
              [
                "A report at the end",
                "Scored by dimension, with the specific points you covered, partly covered, or left out.",
              ],
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
                  <p className="mt-0.5 text-sm leading-relaxed text-[var(--color-muted)]">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="kinds" className="mt-12">
          <h2 id="kinds" className="text-lg font-semibold">Three kinds of interview</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              {
                title: "Topic-based",
                body: "Pick a subject and difficulty. Questions are drawn from a prepared bank for that topic and adapt as you answer.",
              },
              {
                title: "Resume-based",
                body: "Upload your resume and get asked about your own roles, projects and the claims you've made — including being asked to justify them.",
              },
              {
                title: "Your own material",
                body: "Upload notes, a specification or a paper, and be interviewed on that specific content.",
              },
            ].map((k) => (
              <Card key={k.title} className="p-5">
                <p className="text-sm font-semibold">{k.title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted)]">{k.body}</p>
              </Card>
            ))}
          </div>
        </section>

        <section aria-labelledby="feedback" className="mt-12">
          <h2 id="feedback" className="text-lg font-semibold">What the feedback looks like</h2>
          <p className="mt-2.5 text-[15px] leading-relaxed text-[var(--color-muted)]">
            After each interview you get a report built from what you said during it — not a generic
            grade. It shows an overall score, a per-dimension breakdown (correctness, depth, clarity
            and others), and for each question the specific points you covered, partly covered, or
            didn&rsquo;t reach. Where an area wasn&rsquo;t assessed, it says so instead of scoring it
            zero. Over several interviews you can see which areas are improving and which
            aren&rsquo;t.
          </p>
        </section>

        <section aria-labelledby="who" className="mt-12">
          <h2 id="who" className="text-lg font-semibold">Who it&rsquo;s for</h2>
          <p className="mt-2.5 text-[15px] leading-relaxed text-[var(--color-muted)]">
            Students and new graduates facing their first technical interviews. Job seekers who
            want reps before something that matters. Developers and other professionals moving into
            a new domain or a more senior role. Anyone who wants to have said their answers out loud
            a few times before it counts.
          </p>
        </section>

        <section aria-labelledby="honest" className="mt-12">
          <h2 id="honest" className="text-lg font-semibold">What we don&rsquo;t claim</h2>
          <Card className="mt-3 p-5">
            <p className="text-sm leading-relaxed text-[var(--color-ink-soft)]">
              This is a practice tool, not a hiring service. We are not an employer, a recruiter, or
              an agency, and nothing here is an application to a real job.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              The interviewer is an AI system. It can misjudge a good answer, miss something you
              said, or ask something that isn&rsquo;t quite right — so treat its scoring as
              structured practice feedback rather than a verdict. It is not a human interviewer,
              its judgement is not flawless, and we make no claim that every question or
              assessment is factually correct.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              We also can&rsquo;t promise outcomes. Practice here doesn&rsquo;t guarantee you an
              interview, a job offer, or a pass in any real assessment. What it does give you is
              repetition, a realistic format, and specific feedback to work from.
            </p>
          </Card>
        </section>

        <section className="mt-12 rounded-[var(--radius-card)] bg-[var(--color-sunken)] px-6 py-8 text-center">
          <p className="text-base font-medium">Two interviews are free.</p>
          <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-[var(--color-muted)]">
            No card required to try it. See how it feels to answer out loud.
          </p>
          <Link href="/login" className={`${buttonClass.primary} mt-5 px-5 py-3`}>
            Start practising
          </Link>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
