import Link from "next/link";
import type { ReactNode } from "react";
import { BrandWordmark } from "@/components/BrandMark";

/**
 * The handful of surfaces the candidate flow repeats across dashboard, new
 * interview, preview, completion, report, history and progress. Exists to keep
 * one definition of "what a card looks like" rather than re-picking opacities
 * per page — not a component library.
 */

export function Card({ children, className = "", as = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "li" }) {
  const Tag = as;
  return (
    <Tag className={`rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-raised)]/90 shadow-[var(--shadow-card)] backdrop-blur-sm ${className}`}>
      {children}
    </Tag>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-accent-ink)]">
      {children}
    </p>
  );
}

/** Page-level heading block: eyebrow + title + optional supporting line. */
export function PageHeading({ eyebrow, title, sub }: { eyebrow?: string; title: string; sub?: string }) {
  return (
    <div className="space-y-2">
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h1 className="font-display text-[32px] leading-[1.12] sm:text-[40px]">{title}</h1>
      {sub && <p className="max-w-prose text-[15px] leading-relaxed text-[var(--color-muted)]">{sub}</p>}
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
    <div className="px-4 py-4 text-center sm:px-5">
      <p className="font-display text-[28px] tabular-nums leading-none sm:text-[32px]">{value}</p>
      <p className="mt-1.5 text-xs font-medium text-[var(--color-ink-soft)]">{label}</p>
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
    <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-raised)]/50 px-6 py-12 text-center">
      <p className="font-display text-2xl">{title}</p>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[var(--color-muted)]">{body}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-full text-sm font-semibold tracking-tight transition duration-200 disabled:cursor-not-allowed disabled:opacity-50";

export const buttonClass = {
  primary: `${BUTTON_BASE} bg-[var(--color-accent)] px-4 py-2.5 text-white shadow-[0_8px_20px_oklch(0.45_0.16_278_/_0.28)] hover:bg-[var(--color-accent-ink)] hover:shadow-[0_10px_24px_oklch(0.4_0.16_278_/_0.36)]`,
  solid: `${BUTTON_BASE} bg-[var(--color-ink)] px-4 py-2.5 text-white hover:opacity-90`,
  secondary: `${BUTTON_BASE} border border-[var(--color-line-strong)] bg-[var(--color-raised)]/80 px-4 py-2.5 hover:border-[var(--color-ink)]/20 hover:bg-[var(--color-sunken)]`,
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
    <header className="sticky top-0 z-40 border-b border-[var(--color-line)]/80">
      <div className="glass">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="transition hover:opacity-80">
            <BrandWordmark />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
            {nav.map((n) => (
              <Link
                key={n.key}
                href={n.href}
                aria-current={current === n.key ? "page" : undefined}
                className={`rounded-full px-3.5 py-1.5 text-sm transition ${
                  current === n.key
                    ? "bg-[var(--color-ink)] font-medium text-white"
                    : "text-[var(--color-muted)] hover:bg-[var(--color-sunken)] hover:text-[var(--color-ink)]"
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">{right}</div>
        </div>
        {/* Mobile nav: the same destinations, kept reachable without a menu. */}
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto border-t border-[var(--color-line)]/70 px-4 py-2 sm:hidden">
          {nav.map((n) => (
            <Link
              key={n.key}
              href={n.href}
              aria-current={current === n.key ? "page" : undefined}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs transition ${
                current === n.key
                  ? "bg-[var(--color-ink)] font-medium text-white"
                  : "text-[var(--color-muted)]"
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
