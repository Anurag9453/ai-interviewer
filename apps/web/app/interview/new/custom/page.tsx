import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader, PageHeading } from "@/components/ui";
import { CustomInterviewFlow } from "./CustomInterviewFlow";

export default async function CustomInterviewPage() {
  const userId = await requireUserId();
  const supabase = await createClient();

  const { data: credits } = await supabase
    .from("interview_credits").select("granted, consumed").eq("user_id", userId).single();
  const remaining = credits ? Math.max(0, credits.granted - credits.consumed) : 0;

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-2xl px-4 pb-16 pt-7 sm:px-6 sm:pt-10">
        <div className="animate-rise">
          <PageHeading
            eyebrow="Your material"
            title="Interview me on my own material"
            sub="Upload a document and the interviewer builds questions around it. PDF, DOCX, or TXT — up to 10MB."
          />
        </div>
        <div className="mt-6">
          <CustomInterviewFlow hasCredits={remaining > 0} remaining={remaining} />
        </div>
      </main>
    </>
  );
}
