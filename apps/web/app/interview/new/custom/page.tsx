import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CustomInterviewFlow } from "./CustomInterviewFlow";

export default async function CustomInterviewPage() {
  const userId = await requireUserId();
  const supabase = await createClient();

  const { data: credits } = await supabase
    .from("interview_credits").select("granted, consumed").eq("user_id", userId).single();
  const remaining = credits ? Math.max(0, credits.granted - credits.consumed) : 0;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-7 px-6 py-12">
      <div className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-widest text-[var(--color-muted)]">
          New interview
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Interview me on my own material</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Upload a document and the interviewer builds questions around it.
          PDF, DOCX, or TXT — up to 10MB.
        </p>
      </div>

      <CustomInterviewFlow hasCredits={remaining > 0} remaining={remaining} />
    </main>
  );
}
