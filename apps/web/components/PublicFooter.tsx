import Link from "next/link";
import { BrandWordmark } from "@/components/BrandMark";

/**
 * Footer for the public (signed-out) surface: landing, about, refund policy.
 *
 * The link table is exported so a test can assert the routes without
 * rendering React — the repo has no component-test harness, and the thing
 * worth guarding is that these hrefs match real, publicly-reachable routes.
 */
export const PUBLIC_FOOTER_LINKS = [
  { href: "/about", label: "About" },
  { href: "/refund-policy", label: "Refund policy" },
  { href: "/login", label: "Sign in" },
] as const;

export function PublicFooter() {
  return (
    <footer className="mt-24 border-t border-[var(--color-line)] pt-10 pb-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="max-w-sm space-y-3">
          <BrandWordmark />
          <p className="text-sm leading-relaxed text-[var(--color-muted)]">
            Practise interviews out loud. An AI interviewer listens, follows up, and scores what you actually said.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {PUBLIC_FOOTER_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm text-[var(--color-muted)] transition hover:text-[var(--color-ink)]"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
      <p className="mx-auto mt-8 max-w-6xl px-5 text-xs leading-relaxed text-[var(--color-muted)] sm:px-6">
        An AI-powered interview practice tool. Not an employer, recruiter, or hiring service.
      </p>
    </footer>
  );
}
