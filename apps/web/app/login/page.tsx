"use client";

import Link from "next/link";
import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "./actions";
import { GoogleButton } from "./GoogleButton";
import { BrandWordmark } from "@/components/BrandMark";
import { buttonClass } from "@/components/ui";
import { VoiceOrb } from "@/components/VoiceOrb";

const initial: LoginState = { status: "idle" };

export default function LoginPage() {
  const [state, action, pending] = useActionState(sendMagicLink, initial);

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-[var(--color-ink)] px-12 py-12 text-white lg:flex lg:flex-col lg:justify-between">
        <Link href="/" className="relative z-10 w-fit opacity-90 transition hover:opacity-100">
          <BrandWordmark inverted />
        </Link>
        <div className="relative z-10 max-w-md">
          <p className="font-display text-5xl leading-[1.08]">
            Speak the answer. Get the follow-up. See the score.
          </p>
          <p className="mt-5 text-sm leading-relaxed text-white/65">
            Two interviews free. No card required. Your resume stays private to your account.
          </p>
        </div>
        <div className="pointer-events-none absolute -right-16 bottom-10 opacity-80">
          <VoiceOrb size={340} listening />
        </div>
      </section>

      <section className="flex flex-col justify-center px-6 py-12 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" className="mb-10 inline-flex lg:hidden">
            <BrandWordmark />
          </Link>
          <div className="space-y-2">
            <h1 className="font-display text-4xl leading-tight">Sign in</h1>
            <p className="text-sm leading-relaxed text-[var(--color-muted)]">
              Continue with Google, or we&rsquo;ll email you a link.
            </p>
          </div>

          <div className="mt-8">
            <GoogleButton />
          </div>

          <div className="my-6 flex items-center gap-3 text-xs text-[var(--color-muted)]">
            <span className="h-px flex-1 bg-[var(--color-line-strong)]" />
            or
            <span className="h-px flex-1 bg-[var(--color-line-strong)]" />
          </div>

          {state.status === "sent" ? (
            <p className="rounded-[var(--radius-control)] bg-[var(--color-positive-wash)] px-4 py-3 text-sm text-[var(--color-positive)]">
              Check your inbox for the sign-in link.
            </p>
          ) : (
            <form action={action} className="space-y-3">
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                aria-label="Email address"
                className="w-full rounded-full border border-[var(--color-line-strong)] bg-[var(--color-raised)] px-4 py-3 text-sm
                           outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
              />
              <button
                type="submit"
                disabled={pending}
                className={`${buttonClass.solid} w-full py-3`}
              >
                {pending ? "Sending…" : "Email me a link"}
              </button>
              {state.status === "error" && (
                <p role="alert" className="text-sm text-[var(--color-critical)]">
                  {state.message}
                </p>
              )}
            </form>
          )}

          <p className="mt-8 text-center text-xs text-[var(--color-muted)]">
            <Link href="/about" className="hover:text-[var(--color-ink)]">
              About
            </Link>
            {" · "}
            <Link href="/refund-policy" className="hover:text-[var(--color-ink)]">
              Refund policy
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
