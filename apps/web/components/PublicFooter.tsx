import Link from "next/link";

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
    <footer className="mt-20 border-t border-[var(--color-line)] pt-8 pb-4">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2">
          <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--color-ink)] text-[11px] text-white">
            ai
          </span>
          <span className="text-sm font-medium">Interviewer</span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-2">
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
      <p className="mx-auto mt-5 max-w-5xl px-5 text-xs leading-relaxed text-[var(--color-muted)] sm:px-6">
        An AI-powered interview practice tool. Not an employer, recruiter, or hiring service.
      </p>
    </footer>
  );
}
