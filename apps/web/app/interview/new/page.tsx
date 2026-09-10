import Link from "next/link";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { AppHeader, Badge, buttonClass, Card, PageHeading } from "@/components/ui";

/**
 * "What do you want to practise?" — one visual decision before any
 * configuration, replacing the old page that dropped the candidate straight
 * into a fixed summary of the only seeded plan.
 *
 * Availability is read from real content rather than hardcoded: a track with
 * no seeded interview_plans row is shown as not-yet-available instead of
 * leading to a dead end. Adding content makes a track live with no code
 * change here.
 */
export default async function NewInterviewPage() {
  const userId = await requireUserId();
  const supabase = await createClient();

  const [{ data: credits }, { data: categories }] = await Promise.all([
    supabase.from("interview_credits").select("granted, consumed").eq("user_id", userId).single(),
    supabase.from("categories").select("id, label").eq("active", true),
  ]);

  // interview_plans has no client RLS policy at all (it holds grading
  // signals), so even counting availability needs the service client.
  const activeIds = (categories ?? []).map((c) => c.id);
  const { count: planCount } = activeIds.length
    ? await createServiceClient()
        .from("interview_plans")
        .select("*", { count: "exact", head: true })
        .in("category_id", activeIds)
    : { count: 0 };

  const remaining = credits ? Math.max(0, credits.granted - credits.consumed) : 0;
  const standardAvailable = (planCount ?? 0) > 0;

  const tracks = [
    {
      key: "technical",
      title: "Technical",
      body: "Engineering and platform questions from a curated bank, adapting to your answers.",
      href: "/interview/new/topic",
      available: standardAvailable,
      note: standardAvailable ? `${planCount} available` : undefined,
      highlight: false,
    },
    {
      key: "resume",
      title: "Resume interview",
      body: "Upload your resume and be asked about your own roles, projects and claims.",
      href: "/interview/new/resume",
      available: true,
      note: "PDF",
      highlight: true,
    },
    {
      key: "material",
      title: "My own material",
      body: "Upload notes, a spec or a paper and be interviewed on that content.",
      href: "/interview/new/custom",
      available: true,
      note: "PDF, DOCX, TXT",
      highlight: false,
    },
    {
      key: "business",
      title: "Business",
      body: "Product, strategy and stakeholder questions.",
      href: "/interview/new/topic",
      available: false,
      note: undefined,
      highlight: false,
    },
    {
      key: "academic",
      title: "Academic",
      body: "Coursework and viva-style subject questions.",
      href: "/interview/new/topic",
      available: false,
      note: undefined,
      highlight: false,
    },
  ];

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-7 sm:px-6 sm:pt-10">
        <div className="animate-rise">
          <PageHeading
            eyebrow="New interview"
            title="What do you want to practise?"
            sub="Pick a starting point. You'll confirm the details on the next screen before anything begins."
          />
        </div>

        {remaining === 0 && (
          <div className="mt-5 flex flex-col items-start justify-between gap-3 rounded-[var(--radius-card)] bg-[var(--color-caution-wash)] px-5 py-4 sm:flex-row sm:items-center">
            <p className="text-sm text-[var(--color-ink-soft)]">
              You have no interview credits left, so you won&rsquo;t be able to start one yet.
            </p>
            <Link href="/billing" className={`${buttonClass.secondary} shrink-0`}>Get more</Link>
          </div>
        )}

        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {tracks.map((t) => {
            const inner = (
              <div className="flex h-full flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold">{t.title}</p>
                  {!t.available ? (
                    <Badge>Coming soon</Badge>
                  ) : t.note ? (
                    <Badge tone={t.highlight ? "accent" : "neutral"}>{t.note}</Badge>
                  ) : null}
                </div>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-[var(--color-muted)]">{t.body}</p>
                {t.available && (
                  <span aria-hidden className="mt-4 text-sm font-medium text-[var(--color-accent-ink)]">
                    Continue →
                  </span>
                )}
              </div>
            );

            if (!t.available) {
              return (
                <li
                  key={t.key}
                  aria-disabled="true"
                  className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-line-strong)] opacity-60"
                >
                  {inner}
                </li>
              );
            }
            return (
              <Card
                key={t.key}
                as="li"
                className={`overflow-hidden transition hover:shadow-[var(--shadow-lift)] ${
                  t.highlight ? "border-[var(--color-accent)]/30 bg-[var(--color-accent-wash)]" : ""
                }`}
              >
                <Link href={t.href} className="block h-full">{inner}</Link>
              </Card>
            );
          })}
        </ul>

        <p className="mt-7 text-xs leading-relaxed text-[var(--color-muted)]">
          Business and Academic need their own question banks before they can be honest interviews — they&rsquo;ll
          appear here automatically once that content exists.
        </p>
      </main>
    </>
  );
}
