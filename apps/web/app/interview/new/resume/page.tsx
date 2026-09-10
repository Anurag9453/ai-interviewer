import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader, PageHeading } from "@/components/ui";
import { ResumeInterviewFlow } from "./ResumeInterviewFlow";

/**
 * Resume-based interview entry point. The whole flow is client-driven
 * (upload -> analyse -> review -> configure -> start) against the same
 * document APIs the M7 material flow uses; this server component only
 * supplies the credit count.
 */
export default async function ResumeInterviewPage() {
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
            eyebrow="Resume interview"
            title="Interview me on my resume"
            sub="Upload your resume and the interviewer will ask about your actual roles, projects and the claims you've made — then follow up on your answers."
          />
        </div>
        <ResumeInterviewFlow remaining={remaining} />
      </main>
    </>
  );
}
