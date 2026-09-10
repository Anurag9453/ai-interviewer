import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { AppHeader, PageHeading } from "@/components/ui";
import { TopicInterviewFlow, type PlanOption } from "./TopicInterviewFlow";

/**
 * Configuration for a standard (seeded-content) interview.
 *
 * Every option offered here comes from a real interview_plans row, so the
 * candidate can never pick a combination that then fails to start. With one
 * seeded plan today that means one option — which is the honest
 * representation of current content breadth, and it widens automatically as
 * plans are added.
 */
export default async function TopicInterviewPage() {
  const userId = await requireUserId();
  const supabase = await createClient();

  const [{ data: credits }, { data: categories }] = await Promise.all([
    supabase.from("interview_credits").select("granted, consumed").eq("user_id", userId).single(),
    supabase.from("categories").select("id, label").eq("active", true),
  ]);

  const activeIds = (categories ?? []).map((c) => c.id);
  const labels = new Map((categories ?? []).map((c) => [c.id, c.label]));

  // interview_plans and question_pool have no client policy — service client.
  const service = createServiceClient();
  const { data: plans } = activeIds.length
    ? await service
        .from("interview_plans")
        .select("category_id, difficulty, duration_s")
        .in("category_id", activeIds)
    : { data: [] };

  // topics has a permissive read policy, so the cookie client is right here.
  const { data: topics } = activeIds.length
    ? await supabase.from("topics").select("category_id, label, importance").in("category_id", activeIds)
    : { data: [] };

  const options: PlanOption[] = (plans ?? []).map((p) => ({
    categoryId: p.category_id,
    categoryLabel: labels.get(p.category_id) ?? p.category_id,
    difficulty: p.difficulty,
    durationMin: Math.round(p.duration_s / 60),
  }));

  const topicsByCategory: Record<string, string[]> = {};
  for (const t of topics ?? []) {
    const list = (topicsByCategory[t.category_id] ??= []);
    list.push(t.label);
  }

  const remaining = credits ? Math.max(0, credits.granted - credits.consumed) : 0;

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-2xl px-4 pb-16 pt-7 sm:px-6 sm:pt-10">
        <div className="animate-rise">
          <PageHeading
            eyebrow="Technical interview"
            title="Set up your interview"
            sub="Choose what to be tested on. You'll see a summary before anything starts."
          />
        </div>
        <TopicInterviewFlow options={options} topicsByCategory={topicsByCategory} remaining={remaining} />
      </main>
    </>
  );
}
