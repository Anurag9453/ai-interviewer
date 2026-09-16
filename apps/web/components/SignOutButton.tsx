export function SignOutButton() {
  return (
    <form action="/auth/signout" method="post">
      <button
        type="submit"
        className="rounded-full border border-[var(--color-line-strong)] px-3.5 py-1.5 text-sm font-medium text-[var(--color-ink-soft)] transition hover:bg-[var(--color-sunken)]"
      >
        Sign out
      </button>
    </form>
  );
}
