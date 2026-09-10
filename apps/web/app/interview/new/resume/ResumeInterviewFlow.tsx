"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buttonClass, Card, EmptyState } from "@/components/ui";
import { MAX_FILE_SIZE_BYTES } from "@/lib/document-limits";

/**
 * Resume flow: upload -> analyse -> review what was detected -> configure ->
 * start. The review step exists for the same reason M7's does — nobody should
 * be interviewed on a misread document, and the candidate is the only one who
 * can confirm the extraction is right.
 *
 * Types below mirror the server's ResumeProfile shape. Only the fields this
 * screen actually renders are declared, deliberately: the client has no need
 * for the full profile, and a narrower type means less to keep in sync.
 */
interface ProfileRole {
  title: string;
  organization: string | null;
  durationLabel: string | null;
  isCurrent: boolean;
  responsibilities: string[];
  achievements: string[];
  technologies: string[];
}
interface ProfileProject { name: string; summary: string; technologies: string[]; claims: string[] }
interface Profile {
  headline: string;
  domain: string;
  totalExperienceLabel: string | null;
  seniority: string;
  roles: ProfileRole[];
  projects: ProfileProject[];
  skills: string[];
  technologies: string[];
  certifications: string[];
  notableClaims: string[];
  thinAreas: string[];
  suggestedDifficulty: string;
  difficultyRationale: string;
}

type Stage = "idle" | "uploading" | "analyzing" | "review" | "generating" | "starting";

const EMPHASES = [
  { id: "mixed", label: "Mixed", hint: "A balance of everything below" },
  { id: "experience", label: "Experience", hint: "Your roles and what you owned" },
  { id: "technical_depth", label: "Technical depth", hint: "How well you know what you listed" },
  { id: "projects", label: "Projects", hint: "The specific things you built" },
  { id: "problem_solving", label: "Problem solving", hint: "Decisions, trade-offs and failures" },
] as const;

const DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const;
const DURATIONS = [
  { s: 600, label: "10 min" },
  { s: 900, label: "15 min" },
  { s: 1200, label: "20 min" },
  { s: 1800, label: "30 min" },
] as const;

export function ResumeInterviewFlow({ remaining }: { remaining: number }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [stage, setStage] = useState<Stage>("idle");
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [emphasis, setEmphasis] = useState<string>("mixed");
  const [difficulty, setDifficulty] = useState<string | null>(null);
  const [durationS, setDurationS] = useState<number>(900);

  const reset = useCallback(() => {
    setStage("idle");
    setDocumentId(null);
    setFilename(null);
    setProfile(null);
    setError(null);
    setDifficulty(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const onFile = useCallback(async (file: File) => {
    setError(null);
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please upload your resume as a PDF.");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError("That file is larger than 10MB.");
      return;
    }

    setFilename(file.name);
    setStage("uploading");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("documentType", "resume");
      const upload = await fetch("/api/documents", { method: "POST", body: form });
      const uploaded = await upload.json();
      if (!upload.ok) {
        setError(uploaded.message ?? "Couldn't upload that file.");
        setStage("idle");
        return;
      }
      if (uploaded.status === "empty") {
        setError("We couldn't read any text from that PDF — if it's a scan, try a text-based export.");
        setStage("idle");
        return;
      }
      if (uploaded.status === "extraction_failed") {
        setError(uploaded.message ?? "We couldn't read that PDF.");
        setStage("idle");
        return;
      }
      setDocumentId(uploaded.documentId);

      setStage("analyzing");
      const analyzed = await fetch(`/api/documents/${uploaded.documentId}/analyze`, { method: "POST" });
      const analysis = await analyzed.json();
      if (!analyzed.ok) {
        setError("We couldn't analyse that resume. Please try again.");
        setStage("idle");
        return;
      }
      setProfile(analysis.profile as Profile);
      setDifficulty((analysis.profile as Profile).suggestedDifficulty);
      setStage("review");
    } catch {
      setError("Network error — please try again.");
      setStage("idle");
    }
  }, []);

  async function startInterview() {
    if (!documentId || !difficulty) return;
    setError(null);
    setStage("generating");
    try {
      const gen = await fetch(`/api/documents/${documentId}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emphasis, difficulty, durationS }),
      });
      const genBody = await gen.json();
      if (!gen.ok) {
        setError(
          genBody.error === "too_thin"
            ? genBody.message
            : "We couldn't build an interview from this resume. Please try again.",
        );
        setStage("review");
        return;
      }

      setStage("starting");
      const created = await fetch("/api/interviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentId }),
      });
      if (created.status === 402) {
        setError("You're out of interview credits.");
        setStage("review");
        return;
      }
      if (!created.ok) {
        setError("Couldn't start the interview. Please try again.");
        setStage("review");
        return;
      }
      const data = (await created.json()) as { interviewId: string };
      router.push(`/interview?interviewId=${data.interviewId}`);
    } catch {
      setError("Network error — please try again.");
      setStage("review");
    }
  }

  const busy = stage === "uploading" || stage === "analyzing" || stage === "generating" || stage === "starting";
  const busyLabel = {
    uploading: "Uploading your resume…",
    analyzing: "Reading your resume…",
    generating: "Writing your interview questions…",
    starting: "Starting the interview…",
  }[stage as "uploading" | "analyzing" | "generating" | "starting"];

  return (
    <div className="mt-6 space-y-5">
      {stage === "idle" && (
        <>
          <Card className="p-5">
            <label htmlFor="resume-file" className="block text-sm font-medium">
              Your resume
            </label>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              PDF, up to 10MB. It stays private to your account and is only used to build your interview.
            </p>
            <input
              ref={fileInputRef}
              id="resume-file"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
              className="mt-3 block w-full rounded-[var(--radius-control)] border border-[var(--color-line-strong)] bg-[var(--color-raised)]
                         px-3.5 py-2.5 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[var(--color-ink)]
                         file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
            />
            {error && <p role="alert" className="mt-3 text-sm text-[var(--color-critical)]">{error}</p>}
          </Card>

          <p className="text-xs leading-relaxed text-[var(--color-muted)]">
            Your name, contact details and links are deliberately not extracted — only the professional content
            needed to interview you.
          </p>
        </>
      )}

      {busy && (
        <Card className="p-8 text-center">
          <div aria-hidden className="mx-auto flex h-10 w-10 items-center justify-center">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-line-strong)] border-t-[var(--color-accent)]" />
          </div>
          <p aria-live="polite" className="mt-3 text-sm font-medium">{busyLabel}</p>
          {filename && <p className="mt-1 text-xs text-[var(--color-muted)]">{filename}</p>}
          {stage === "analyzing" && (
            <p className="mt-2 text-xs text-[var(--color-muted)]">This usually takes 10–20 seconds.</p>
          )}
        </Card>
      )}

      {stage === "review" && profile && (
        <>
          <Card className="animate-rise p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
                  What we found
                </p>
                <p className="mt-1 font-semibold">{profile.headline}</p>
                <p className="text-sm text-[var(--color-muted)]">
                  {profile.domain}
                  {profile.totalExperienceLabel ? ` · ${profile.totalExperienceLabel}` : ""}
                </p>
              </div>
              <button onClick={reset} className={buttonClass.quiet}>Replace</button>
            </div>

            {profile.roles.length > 0 && (
              <Detected title="Roles">
                <ul className="space-y-1.5">
                  {profile.roles.map((r, i) => (
                    <li key={`${r.title}-${i}`} className="text-sm">
                      <span className="font-medium">{r.title}</span>
                      {r.organization ? <span className="text-[var(--color-muted)]"> · {r.organization}</span> : null}
                      {r.durationLabel ? <span className="text-[var(--color-muted)]"> · {r.durationLabel}</span> : null}
                    </li>
                  ))}
                </ul>
              </Detected>
            )}

            {profile.projects.length > 0 && (
              <Detected title="Projects">
                <ul className="space-y-1.5">
                  {profile.projects.map((p, i) => (
                    <li key={`${p.name}-${i}`} className="text-sm">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-[var(--color-muted)]"> — {p.summary}</span>
                    </li>
                  ))}
                </ul>
              </Detected>
            )}

            {profile.notableClaims.length > 0 && (
              <Detected title="Claims the interviewer may probe">
                <ul className="space-y-1 text-sm text-[var(--color-ink-soft)]">
                  {profile.notableClaims.slice(0, 6).map((c) => <li key={c}>&ldquo;{c}&rdquo;</li>)}
                </ul>
              </Detected>
            )}

            {(profile.technologies.length > 0 || profile.skills.length > 0) && (
              <Detected title="Skills and technologies">
                <div className="flex flex-wrap gap-1.5">
                  {[...profile.technologies, ...profile.skills].slice(0, 18).map((t) => (
                    <span key={t} className="rounded-full bg-[var(--color-sunken)] px-2.5 py-1 text-xs text-[var(--color-ink-soft)]">
                      {t}
                    </span>
                  ))}
                </div>
              </Detected>
            )}

            {profile.thinAreas.length > 0 && (
              <Detected title="Thin on detail — expect to be asked">
                <ul className="space-y-1 text-sm text-[var(--color-muted)]">
                  {profile.thinAreas.slice(0, 5).map((t) => <li key={t}>{t}</li>)}
                </ul>
              </Detected>
            )}

            {profile.roles.length === 0 && profile.projects.length === 0 && (
              <p className="mt-4 rounded-[var(--radius-control)] bg-[var(--color-caution-wash)] px-4 py-3 text-sm text-[var(--color-ink-soft)]">
                We didn&rsquo;t find distinct roles or projects. The interview will lean on your skills instead — or
                replace the file if this looks wrong.
              </p>
            )}
          </Card>

          <Card className="animate-rise p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
              Configure
            </p>

            <fieldset className="mt-3">
              <legend className="text-sm font-medium">Emphasis</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {EMPHASES.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setEmphasis(e.id)}
                    aria-pressed={emphasis === e.id}
                    className={`rounded-[var(--radius-control)] border px-3.5 py-2.5 text-left transition ${
                      emphasis === e.id
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-wash)]"
                        : "border-[var(--color-line-strong)] hover:bg-[var(--color-sunken)]"
                    }`}
                  >
                    <span className="block text-sm font-medium">{e.label}</span>
                    <span className="block text-xs text-[var(--color-muted)]">{e.hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="mt-4">
              <legend className="text-sm font-medium">Difficulty</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {DIFFICULTIES.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDifficulty(d)}
                    aria-pressed={difficulty === d}
                    className={`rounded-[var(--radius-control)] border px-4 py-2 text-sm font-medium capitalize transition ${
                      difficulty === d
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-wash)] text-[var(--color-accent-ink)]"
                        : "border-[var(--color-line-strong)] hover:bg-[var(--color-sunken)]"
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
              {difficulty === profile.suggestedDifficulty && (
                <p className="mt-1.5 text-xs text-[var(--color-muted)]">
                  Suggested from your resume: {profile.difficultyRationale}
                </p>
              )}
            </fieldset>

            <fieldset className="mt-4">
              <legend className="text-sm font-medium">Length</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {DURATIONS.map((d) => (
                  <button
                    key={d.s}
                    type="button"
                    onClick={() => setDurationS(d.s)}
                    aria-pressed={durationS === d.s}
                    className={`rounded-[var(--radius-control)] border px-4 py-2 text-sm font-medium transition ${
                      durationS === d.s
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-wash)] text-[var(--color-accent-ink)]"
                        : "border-[var(--color-line-strong)] hover:bg-[var(--color-sunken)]"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="mt-5 border-t border-[var(--color-line)] pt-4">
              {remaining === 0 ? (
                <div className="space-y-2.5">
                  <p className="rounded-[var(--radius-control)] bg-[var(--color-caution-wash)] px-4 py-3 text-sm text-[var(--color-ink-soft)]">
                    You have no interview credits left.
                  </p>
                  <Link href="/billing" className={`${buttonClass.primary} w-full`}>Get more credits</Link>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => void startInterview()}
                    disabled={!difficulty}
                    className={`${buttonClass.primary} w-full py-3`}
                  >
                    Start resume interview
                  </button>
                  <p className="mt-2 text-center text-xs text-[var(--color-muted)]">
                    Uses 1 of your {remaining} remaining credit{remaining === 1 ? "" : "s"} · questions are written
                    from your resume first
                  </p>
                </>
              )}
              {error && <p role="alert" className="mt-2 text-center text-sm text-[var(--color-critical)]">{error}</p>}
            </div>
          </Card>
        </>
      )}

      {stage === "idle" && error === null && documentId === null && (
        <EmptyState
          title="Not sure what to expect?"
          body="You'll be asked to walk through what you actually did — the architecture behind a project you listed, why you chose an approach, and what you'd do differently."
        />
      )}
    </div>
  );
}

function Detected({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 border-t border-[var(--color-line)] pt-3.5">
      <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-soft)]">{title}</p>
      {children}
    </div>
  );
}
