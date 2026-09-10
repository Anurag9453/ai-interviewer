import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The handful of surfaces the candidate flow repeats across dashboard, new
 * interview, preview, completion, report, history and progress. Exists to keep
 * one definition of "what a card looks like" rather than re-picking opacities
 * per page — not a component library.
 */

export function Card({ children, className = "", as = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "li" }) {
  const Tag = as;
  return (
    <Tag className={`rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-raised)] shadow-[var(--shadow-card)] ${className}`}>
      {children}
    </Tag>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
      {children}
    </p>
  );
}

/** Page-level heading block: eyebrow + title + optional supporting line. */
export function PageHeading({ eyebrow, title, sub }: { eyebrow?: string; title: string; sub?: string }) {
  return (
    <div className="space-y-1.5">
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h1 className="text-[26px] font-semibold leading-tight sm:text-3xl">{title}</h1>
      {sub && <p className="max-w-prose text-sm leading-relaxed text-[var(--color-muted)]">{sub}</p>}
    </div>
  );
}

type Tone = "neutral" | "accent" | "positive" | "caution" | "critical";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-[var(--color-sunken)] text-[var(--color-ink-soft)]",
  accent: "bg-[var(--color-accent-wash)] text-[var(--color-accent-ink)]",
  positive: "bg-[var(--color-positive-wash)] text-[var(--color-positive)]",
  caution: "bg-[var(--color-caution-wash)] text-[var(--color-caution)]",
  critical: "bg-[color-mix(in_oklch,var(--color-critical)_10%,white)] text-[var(--color-critical)]",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

/** A number with a label. Used for credits / counts / averages. */
export function Stat({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div className="px-4 py-3.5 text-center sm:px-5">
      <p className="text-2xl font-semibold tabular-nums sm:text-[28px]">{value}</p>
      <p className="mt-0.5 text-xs font-medium text-[var(--color-ink-soft)]">{label}</p>
      {hint && <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">{hint}</p>}
    </div>
  );
}

/**
 * Empty states carry real weight in this product — a new user sees three of
 * them before they see any data, so they get a proper treatment rather than a
 * grey sentence.
 */
export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-line-strong)] px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-[var(--color-muted)]">{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";

export const buttonClass = {
  primary: `${BUTTON_BASE} bg-[var(--color-accent)] px-4 py-2.5 text-white hover:bg-[var(--color-accent-ink)]`,
  solid: `${BUTTON_BASE} bg-[var(--color-ink)] px-4 py-2.5 text-white hover:opacity-90`,
  secondary: `${BUTTON_BASE} border border-[var(--color-line-strong)] bg-[var(--color-raised)] px-4 py-2.5 hover:bg-[var(--color-sunken)]`,
  quiet: `${BUTTON_BASE} px-3 py-2 text-[var(--color-ink-soft)] hover:bg-[var(--color-sunken)]`,
};

/** Shared top bar for the signed-in candidate pages. */
export function AppHeader({ current, right }: { current?: "dashboard" | "history" | "progress" | "billing"; right?: ReactNode }) {
  const nav: Array<{ key: "dashboard" | "history" | "progress" | "billing"; href: string; label: string }> = [
    { key: "dashboard", href: "/dashboard", label: "Home" },
    { key: "history", href: "/interviews", label: "Interviews" },
    { key: "progress", href: "/progress", label: "Progress" },
    { key: "billing", href: "/billing", label: "Plan" },
  ];
  return (
    <header className="border-b border-[var(--color-line)] bg-[var(--color-raised)]/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-ink)] text-[13px] text-white">
            ai
          </span>
          <span className="text-[15px]">Interviewer</span>
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
          {nav.map((n) => (
            <Link
              key={n.key}
              href={n.href}
              aria-current={current === n.key ? "page" : undefined}
              className={`rounded-[var(--radius-control)] px-3 py-1.5 text-sm transition ${
                current === n.key
                  ? "bg-[var(--color-sunken)] font-medium text-[var(--color-ink)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">{right}</div>
      </div>
      {/* Mobile nav: the same destinations, kept reachable without a menu. */}
      <nav aria-label="Main" className="flex gap-1 overflow-x-auto border-t border-[var(--color-line)] px-4 py-2 sm:hidden">
        {nav.map((n) => (
          <Link
            key={n.key}
            href={n.href}
            aria-current={current === n.key ? "page" : undefined}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs transition ${
              current === n.key
                ? "bg-[var(--color-sunken)] font-medium"
                : "text-[var(--color-muted)]"
            }`}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
