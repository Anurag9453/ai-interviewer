import Link from "next/link";
import { requireAdminPage } from "@/lib/admin";
import { AdminOverview } from "./AdminOverview";

export default async function AdminPage() {
  await requireAdminPage();

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-[var(--color-muted)]">Admin</p>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/promotions" className="rounded-lg border border-black/12 px-3.5 py-2 text-sm font-medium hover:bg-black/[0.04]">
            Promotions
          </Link>
          <Link href="/dashboard" className="rounded-lg border border-black/12 px-3.5 py-2 text-sm font-medium hover:bg-black/[0.04]">
            Back to app
          </Link>
        </div>
      </div>
      <AdminOverview />
    </main>
  );
}
