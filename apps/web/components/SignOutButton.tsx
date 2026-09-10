export function SignOutButton() {
  return (
    <form action="/auth/signout" method="post">
      <button
        type="submit"
        className="rounded-lg border border-black/12 px-3 py-1.5 text-sm font-medium hover:bg-black/[0.04]"
      >
        Sign out
      </button>
    </form>
  );
}
