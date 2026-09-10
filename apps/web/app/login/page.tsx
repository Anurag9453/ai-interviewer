"use client";

import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "./actions";
import { GoogleButton } from "./GoogleButton";

const initial: LoginState = { status: "idle" };

export default function LoginPage() {
  const [state, action, pending] = useActionState(sendMagicLink, initial);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Continue with Google, or we&rsquo;ll email you a link.
        </p>
      </div>

      <GoogleButton />

      <div className="flex items-center gap-3 text-xs text-[var(--color-muted)]">
        <span className="h-px flex-1 bg-black/10" />
        or
        <span className="h-px flex-1 bg-black/10" />
      </div>

      {state.status === "sent" ? (
        <p className="rounded-lg bg-black/5 px-4 py-3 text-sm">
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
            className="w-full rounded-lg border border-black/12 px-3.5 py-2.5 text-sm
                       outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          />
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-[var(--color-ink)] px-3.5 py-2.5 text-sm
                       font-medium text-white disabled:opacity-50"
          >
            {pending ? "Sending…" : "Email me a link"}
          </button>
          {state.status === "error" && (
            <p role="alert" className="text-sm text-red-600">
              {state.message}
            </p>
          )}
        </form>
      )}
    </main>
  );
}
