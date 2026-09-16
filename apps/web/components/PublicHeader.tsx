import Link from "next/link";
import { BrandWordmark } from "@/components/BrandMark";
import { buttonClass } from "@/components/ui";

export function PublicHeader({ current }: { current?: "about" | "login" }) {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-line)]/70">
      <div className="glass">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5 sm:px-6">
          <Link href="/" className="transition hover:opacity-80">
            <BrandWordmark />
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-1.5 sm:gap-2">
            <Link
              href="/about"
              aria-current={current === "about" ? "page" : undefined}
              className={`hidden rounded-full px-3 py-1.5 text-sm transition sm:inline ${
                current === "about"
                  ? "bg-[var(--color-sunken)] font-medium"
                  : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              }`}
            >
              About
            </Link>
            <Link href="/login" className={`${buttonClass.quiet} hidden sm:inline-flex`}>
              Sign in
            </Link>
            <Link href="/login" className={`${buttonClass.primary} px-4 py-2`}>
              Start free
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
