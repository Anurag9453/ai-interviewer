import Link from "next/link";
import { requireAdminPage } from "@/lib/admin";
import { PromotionsManager } from "./PromotionsManager";

export default async function AdminPromotionsPage() {
  await requireAdminPage();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-[var(--color-muted)]">Admin</p>
          <h1 className="text-2xl font-semibold tracking-tight">Promotions</h1>
        </div>
        <Link href="/admin" className="rounded-lg border border-black/12 px-3.5 py-2 text-sm font-medium hover:bg-black/[0.04]">
          Back to overview
        </Link>
      </div>
      <PromotionsManager />
    </main>
  );
}
