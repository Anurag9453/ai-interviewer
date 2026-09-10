"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_FILE_SIZE_BYTES } from "@/lib/document-limits";

type DocStatus =
  | "uploaded" | "extracted" | "empty" | "extraction_failed"
  | "analyzed" | "analysis_failed" | "generated" | "generation_failed";

interface DocumentState {
  documentId: string;
  filename: string;
  status: DocStatus;
  errorMessage?: string;
  extractedCharCount?: number;
  truncated?: boolean;
  blueprint?: Blueprint;
}

interface BlueprintTopic { id: string; label: string; description: string; importance: number }
interface Blueprint {
  subject: string; domain: string; topics: BlueprintTopic[];
  suggestedDifficulty: string; difficultyRationale: string;
}

type FlowState =
  | { phase: "idle" }
  | { phase: "uploading"; percent: number }
  | { phase: "ready"; doc: DocumentState }
  | { phase: "analyzing"; doc: DocumentState }
  | { phase: "generating"; doc: DocumentState }
  | { phase: "starting"; doc: DocumentState };

const MAX_MB = Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024));

export function CustomInterviewFlow({ hasCredits, remaining }: { hasCredits: boolean; remaining: number }) {
  const router = useRouter();
  const [state, setState] = useState<FlowState>({ phase: "idle" });
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setState({ phase: "idle" });
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const cancelDocument = useCallback(async (documentId: string) => {
    await fetch(`/api/documents/${documentId}`, { method: "DELETE" }).catch(() => {});
    reset();
  }, [reset]);

  const onFileChosen = useCallback((file: File) => {
    setError(null);
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(`File is too large (max ${MAX_MB}MB).`);
      return;
    }
    const form = new FormData();
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) setState({ phase: "uploading", percent: Math.round((e.loaded / e.total) * 100) });
    });
    xhr.addEventListener("load", () => {
      try {
        const body = JSON.parse(xhr.responseText);
        if (xhr.status >= 400) {
          setError(body.message ?? "Upload failed. Please try again.");
          setState({ phase: "idle" });
          return;
        }
        setState({
          phase: "ready",
          doc: { documentId: body.documentId, filename: file.name, status: body.status, extractedCharCount: body.extractedCharCount, truncated: body.truncated, errorMessage: body.message },
        });
      } catch {
        setError("Upload failed. Please try again.");
        setState({ phase: "idle" });
      }
    });
    xhr.addEventListener("error", () => {
      setError("Network error during upload. Please try again.");
      setState({ phase: "idle" });
    });
    xhr.open("POST", "/api/documents");
    xhr.send(form);
    setState({ phase: "uploading", percent: 0 });
  }, []);

  const runAnalyze = useCallback(async (doc: DocumentState) => {
    setState({ phase: "analyzing", doc });
    setError(null);
    try {
      const res = await fetch(`/api/documents/${doc.documentId}/analyze`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setState({ phase: "ready", doc: { ...doc, status: "analysis_failed", errorMessage: body.message } });
        return;
      }
      setState({ phase: "ready", doc: { ...doc, status: "analyzed", blueprint: body.blueprint } });
    } catch {
      setState({ phase: "ready", doc: { ...doc, status: "analysis_failed", errorMessage: "Network error." } });
    }
  }, []);

  const runGenerate = useCallback(async (doc: DocumentState) => {
    setState({ phase: "generating", doc });
    setError(null);
    try {
      const res = await fetch(`/api/documents/${doc.documentId}/generate`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setState({ phase: "ready", doc: { ...doc, status: "generation_failed", errorMessage: body.message } });
        return;
      }
      setState({ phase: "ready", doc: { ...doc, status: "generated" } });
    } catch {
      setState({ phase: "ready", doc: { ...doc, status: "generation_failed", errorMessage: "Network error." } });
    }
  }, []);

  const startInterview = useCallback(async (doc: DocumentState) => {
    setState({ phase: "starting", doc });
    setError(null);
    try {
      const res = await fetch("/api/interviews", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentId: doc.documentId }),
      });
      if (res.status === 402) {
        setError("You're out of interview credits. You can top up from the billing page.");
        setState({ phase: "ready", doc });
        return;
      }
      if (!res.ok) {
        setError("Couldn't start the interview. Please try again.");
        setState({ phase: "ready", doc });
        return;
      }
      const data = await res.json();
      router.push(`/interview?interviewId=${data.interviewId}`);
    } catch {
      setError("Network error — please try again.");
      setState({ phase: "ready", doc });
    }
  }, [router]);

  if (!hasCredits) {
    return (
      <div className="rounded-[var(--radius-card)] bg-[var(--color-caution-wash)] px-5 py-4">
        <p className="text-sm text-[var(--color-ink-soft)]">You&rsquo;re out of interview credits.</p>
        <a
          href="/billing"
          className="mt-2.5 inline-flex rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
        >
          Get more credits
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {state.phase === "idle" && (
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-black/20 px-5 py-10 text-center hover:border-black/35">
          <span className="text-sm font-medium">Choose a file to upload</span>
          <span className="text-xs text-[var(--color-muted)]">PDF, DOCX, or TXT — up to {MAX_MB}MB</span>
          <input
            ref={fileInputRef} type="file" accept=".pdf,.docx,.txt" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileChosen(f); }}
          />
        </label>
      )}

      {state.phase === "uploading" && (
        <div className="space-y-2 rounded-xl border border-black/8 px-5 py-6 text-center">
          <p className="text-sm font-medium">Uploading…</p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/8">
            <div className="h-full bg-[var(--color-accent)] transition-all" style={{ width: `${state.percent}%` }} />
          </div>
        </div>
      )}

      {(state.phase === "ready" || state.phase === "analyzing" || state.phase === "generating" || state.phase === "starting") && (
        <DocPanel
          doc={state.doc}
          busy={state.phase !== "ready"}
          busyLabel={state.phase === "analyzing" ? "Reading your document…" : state.phase === "generating" ? "Building your interview…" : state.phase === "starting" ? "Starting…" : undefined}
          onAnalyze={() => void runAnalyze(state.doc)}
          onGenerate={() => void runGenerate(state.doc)}
          onStart={() => void startInterview(state.doc)}
          onCancel={() => void cancelDocument(state.doc.documentId)}
          onRetryUpload={reset}
        />
      )}

      {error && <p role="alert" className="text-center text-sm text-red-600">{error}</p>}
      {state.phase === "ready" && (
        <p className="text-center text-xs text-[var(--color-muted)]">{remaining} free interview{remaining === 1 ? "" : "s"} remaining</p>
      )}
    </div>
  );
}

function DocPanel({
  doc, busy, busyLabel, onAnalyze, onGenerate, onStart, onCancel, onRetryUpload,
}: {
  doc: DocumentState; busy: boolean; busyLabel: string | undefined;
  onAnalyze: () => void; onGenerate: () => void; onStart: () => void;
  onCancel: () => void; onRetryUpload: () => void;
}) {
  return (
    <div className="space-y-4 rounded-xl border border-black/8 px-5 py-5">
      <div className="flex items-center justify-between">
        <p className="truncate text-sm font-medium">{doc.filename}</p>
        {!busy && doc.status !== "generated" && (
          <button onClick={onCancel} className="shrink-0 text-xs text-[var(--color-muted)] hover:underline">
            Remove
          </button>
        )}
      </div>

      {busy && (
        <p className="text-sm text-[var(--color-muted)]" aria-live="polite">{busyLabel}</p>
      )}

      {!busy && doc.status === "extracted" && (
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-muted)]">
            Extracted {doc.extractedCharCount?.toLocaleString()} characters
            {doc.truncated ? " (document was long — only the first part will be used)" : ""}.
          </p>
          <button onClick={onAnalyze} className="w-full rounded-lg bg-[var(--color-accent)] px-3.5 py-2.5 text-sm font-medium text-white">
            Analyze document
          </button>
        </div>
      )}

      {!busy && doc.status === "empty" && (
        <div className="space-y-3">
          <p className="text-sm text-red-600">
            We couldn&rsquo;t find enough readable text in this file — it may be a scanned image or mostly blank.
          </p>
          <button onClick={onRetryUpload} className="w-full rounded-lg border border-black/12 px-3.5 py-2.5 text-sm font-medium hover:bg-black/[0.04]">
            Try a different file
          </button>
        </div>
      )}

      {!busy && doc.status === "extraction_failed" && (
        <div className="space-y-3">
          <p className="text-sm text-red-600">{doc.errorMessage ?? "Couldn't read this file."}</p>
          <button onClick={onRetryUpload} className="w-full rounded-lg border border-black/12 px-3.5 py-2.5 text-sm font-medium hover:bg-black/[0.04]">
            Try a different file
          </button>
        </div>
      )}

      {!busy && doc.status === "analysis_failed" && (
        <div className="space-y-3">
          <p className="text-sm text-red-600">{doc.errorMessage ?? "Analysis failed."}</p>
          <button onClick={onAnalyze} className="w-full rounded-lg bg-[var(--color-accent)] px-3.5 py-2.5 text-sm font-medium text-white">
            Try analyzing again
          </button>
        </div>
      )}

      {!busy && doc.status === "analyzed" && doc.blueprint && (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">{doc.blueprint.subject}</p>
            <p className="text-xs text-[var(--color-muted)]">
              {doc.blueprint.domain} · Suggested difficulty: {doc.blueprint.suggestedDifficulty}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {doc.blueprint.topics.map((t) => (
              <span key={t.id} className="rounded-full bg-black/[0.04] px-2.5 py-1 text-xs">{t.label}</span>
            ))}
          </div>
          <button onClick={onGenerate} className="w-full rounded-lg bg-[var(--color-accent)] px-3.5 py-2.5 text-sm font-medium text-white">
            Build interview from this
          </button>
        </div>
      )}

      {!busy && doc.status === "generation_failed" && (
        <div className="space-y-3">
          <p className="text-sm text-red-600">{doc.errorMessage ?? "Couldn't build an interview from this document."}</p>
          <button onClick={onGenerate} className="w-full rounded-lg bg-[var(--color-accent)] px-3.5 py-2.5 text-sm font-medium text-white">
            Try again
          </button>
        </div>
      )}

      {!busy && doc.status === "generated" && (
        <div className="space-y-3">
          <p className="text-sm text-emerald-700">Your interview is ready.</p>
          <button onClick={onStart} className="w-full rounded-lg bg-[var(--color-accent)] px-3.5 py-2.5 text-sm font-medium text-white">
            Start interview
          </button>
        </div>
      )}
    </div>
  );
}
