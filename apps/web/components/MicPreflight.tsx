"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Status = "idle" | "requesting" | "denied" | "no_device" | "silent" | "ready" | "error";

const MESSAGE: Record<Status, string> = {
  idle: "We need your microphone before we start.",
  requesting: "Waiting for microphone permission…",
  denied: "Microphone access was blocked. Enable it in your browser's site settings, then try again.",
  no_device: "No microphone was found. Connect one and try again.",
  silent: "We can reach your microphone but aren't hearing anything. Say something.",
  ready: "Microphone is working.",
  error: "Something went wrong reaching your microphone.",
};

/**
 * Pre-flight gate. Catching a dead microphone here rather than eight minutes
 * into an interview is the whole point — a candidate who has to restart has
 * already lost confidence in the product.
 */
export function MicPreflight({ onReady }: { onReady: (stream: MediaStream) => void }) {
  const [status, setStatus] = useState<Status>("idle");
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    void ctxRef.current?.close();
    ctxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const request = useCallback(async () => {
    setStatus("requesting");
    setPeak(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);

      setStatus("silent");
      const loop = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length);
        const norm = Math.min(1, rms * 8);
        setLevel(norm);
        setPeak((p) => {
          const next = Math.max(p, norm);
          // A real voice clears this easily; room noise does not.
          if (next > 0.12) setStatus("ready");
          return next;
        });
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setStatus(
        name === "NotAllowedError" || name === "SecurityError" ? "denied"
        : name === "NotFoundError" || name === "OverconstrainedError" ? "no_device"
        : "error",
      );
    }
  }, []);

  const bars = 24;
  const lit = Math.round(level * bars);

  return (
    <div data-theme="studio" className="flex min-h-screen flex-col justify-center px-6">
      <div className="mx-auto flex w-full max-w-md flex-col gap-7">
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-accent-ink)]">
          Before we begin
        </p>
        <h1 className="font-display text-4xl leading-tight">Microphone check</h1>
      </div>

      <div className="flex h-12 items-end gap-[3px]" role="meter"
           aria-label="Microphone input level" aria-valuenow={Math.round(level * 100)}
           aria-valuemin={0} aria-valuemax={100}>
        {Array.from({ length: bars }, (_, i) => (
          <span key={i}
            className="w-full rounded-sm transition-[height,background-color] duration-75"
            style={{
              height: `${12 + (i < lit ? 36 * (0.3 + 0.7 * (i / bars)) : 0)}%`,
              backgroundColor: i < lit ? "var(--color-accent)" : "color-mix(in oklch, var(--color-ink) 12%, transparent)",
            }}
          />
        ))}
      </div>

      <p aria-live="polite"
         className={status === "denied" || status === "no_device" || status === "error"
           ? "text-sm text-[var(--color-critical)]" : "text-sm text-[var(--color-muted)]"}>
        {MESSAGE[status]}
      </p>

      <div className="flex gap-2.5">
        {status === "idle" || status === "denied" || status === "no_device" || status === "error" ? (
          <button onClick={() => void request()}
            className="rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-[var(--color-surface)]">
            {status === "idle" ? "Allow microphone" : "Try again"}
          </button>
        ) : null}
        <button
          disabled={status !== "ready"}
          onClick={() => { if (streamRef.current) onReady(streamRef.current); }}
          className="rounded-full bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--color-surface)] disabled:opacity-40">
          Start interview
        </button>
      </div>
      </div>
    </div>
  );
}
