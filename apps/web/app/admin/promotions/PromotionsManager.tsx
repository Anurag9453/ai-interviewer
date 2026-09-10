"use client";

import { useCallback, useEffect, useState } from "react";

interface Promotion {
  id: string; code: string; percent_off: number | null; amount_off_cents: number | null;
  active: boolean; redemption_limit: number | null; per_user_limit: number; redemptionCount: number;
}

export function PromotionsManager() {
  const [promotions, setPromotions] = useState<Promotion[] | null>(null);
  const [code, setCode] = useState("");
  const [percentOff, setPercentOff] = useState("");
  const [redemptionLimit, setRedemptionLimit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    fetch("/api/admin/promotions").then((r) => r.json()).then((body) => setPromotions(body.promotions ?? []));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create() {
    setError(null);
    if (!code.trim() || !percentOff) { setError("Code and percent off are required."); return; }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/promotions", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: code.trim(), percentOff: Number(percentOff),
          redemptionLimit: redemptionLimit ? Number(redemptionLimit) : undefined,
        }),
      });
      if (!res.ok) { setError("Couldn't create promotion."); return; }
      setCode(""); setPercentOff(""); setRedemptionLimit("");
      load();
    } finally {
      setCreating(false);
    }
  }

  async function toggle(id: string, active: boolean) {
    await fetch(`/api/admin/promotions/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !active }),
    });
    load();
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-black/8 p-5">
        <h2 className="mb-3 text-sm font-medium">New promotion</h2>
        <div className="grid grid-cols-3 gap-2.5">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CODE"
            className="rounded-lg border border-black/12 px-3 py-2 text-sm" />
          <input value={percentOff} onChange={(e) => setPercentOff(e.target.value)} placeholder="% off" type="number"
            className="rounded-lg border border-black/12 px-3 py-2 text-sm" />
          <input value={redemptionLimit} onChange={(e) => setRedemptionLimit(e.target.value)} placeholder="Max redemptions (optional)" type="number"
            className="rounded-lg border border-black/12 px-3 py-2 text-sm" />
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button onClick={() => void create()} disabled={creating}
          className="mt-3 rounded-lg bg-[var(--color-accent)] px-3.5 py-2 text-sm font-medium text-white disabled:opacity-50">
          {creating ? "Creating…" : "Create"}
        </button>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-[var(--color-muted)]">Existing promotions</h2>
        {!promotions ? (
          <p className="text-sm text-[var(--color-muted)]">Loading…</p>
        ) : promotions.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">No promotions yet.</p>
        ) : (
          <ul className="divide-y divide-black/8 rounded-xl border border-black/8">
            {promotions.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <p className="text-sm font-medium">{p.code}</p>
                  <p className="text-xs text-[var(--color-muted)]">
                    {p.percent_off ? `${p.percent_off}% off` : `₹${((p.amount_off_cents ?? 0) / 100).toFixed(2)} off`}
                    {" · "}{p.redemptionCount} redeemed{p.redemption_limit ? ` / ${p.redemption_limit}` : ""}
                  </p>
                </div>
                <button onClick={() => void toggle(p.id, p.active)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${p.active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-black/12 text-[var(--color-muted)]"}`}>
                  {p.active ? "Active" : "Inactive"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
