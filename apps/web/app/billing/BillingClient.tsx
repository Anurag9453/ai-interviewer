"use client";

import { useCallback, useEffect, useState } from "react";

interface Product {
  id: string; name: string; kind: "subscription" | "topup"; interview_quantity: number;
  price_cents: number; currency: string; billing_interval: string | null; description: string | null;
}

interface Transaction {
  id: string; product_id: string; status: string; amount_cents: number; currency: string; created_at: string;
}

interface Subscription {
  id: string; product_id: string; status: string; current_period_end: string | null; cancel_at_period_end: boolean;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function rupees(cents: number): string {
  return `₹${(cents / 100).toFixed(2)}`;
}

export function BillingClient({ products }: { products: Product[] }) {
  const [history, setHistory] = useState<{ transactions: Transaction[]; subscriptions: Subscription[] } | null>(null);
  const [promoCode, setPromoCode] = useState("");
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/billing/history").then((r) => r.json()).then(setHistory).catch(() => {});
  }, []);

  useEffect(() => {
    if (document.getElementById("razorpay-checkout-js")) return;
    const script = document.createElement("script");
    script.id = "razorpay-checkout-js";
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    document.body.appendChild(script);
  }, []);

  const purchase = useCallback(async (product: Product) => {
    setError(null);
    setBusyProductId(product.id);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId: product.id, promoCode: promoCode.trim() || undefined }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(
          body.error === "billing_not_configured" ? "Payments aren't set up yet — check back soon."
          : body.error === "promo_not_applicable" ? `That code doesn't apply (${body.reason}).`
          : body.error === "invalid_promo_code" ? "That promo code doesn't exist."
          : "Couldn't start checkout. Please try again.",
        );
        return;
      }
      if (!window.Razorpay) {
        setError("Payment provider is still loading — try again in a moment.");
        return;
      }
      const rzp = new window.Razorpay({
        key: body.keyId,
        amount: body.amountCents,
        currency: body.currency,
        name: "AI Interviewer",
        description: product.name,
        ...(body.kind === "order" ? { order_id: body.orderId } : { subscription_id: body.subscriptionId }),
        handler: () => {
          // Deliberately does nothing beyond letting Razorpay show its own
          // success screen — credits are granted by the server-verified
          // webhook, never by this client callback. See billing-webhook.ts.
        },
      });
      rzp.open();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusyProductId(null);
    }
  }, [promoCode]);

  const activeSubscription = history?.subscriptions.find((s) => s.status === "active");

  return (
    <div className="space-y-8">
      {activeSubscription && (
        <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-raised)] px-5 py-4 shadow-[var(--shadow-card)]">
          <p className="text-xs font-medium uppercase tracking-widest text-[var(--color-muted)]">Subscription</p>
          <p className="mt-1 text-sm">
            {activeSubscription.product_id} — {activeSubscription.cancel_at_period_end ? "cancels" : "renews"} on{" "}
            {activeSubscription.current_period_end ? new Date(activeSubscription.current_period_end).toLocaleDateString() : "—"}
          </p>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-medium text-[var(--color-muted)]">Available plans</h2>
        <div className="mb-3">
          <input
            value={promoCode} onChange={(e) => setPromoCode(e.target.value)} placeholder="Promo code (optional)"
            className="w-full rounded-full border border-[var(--color-line-strong)] bg-[var(--color-raised)] px-4 py-2.5 text-sm"
          />
        </div>
        {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
        <ul className="space-y-2.5">
          {products.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-raised)] px-5 py-4 shadow-[var(--shadow-card)]">
              <div>
                <p className="text-sm font-medium">{p.name}</p>
                <p className="text-xs text-[var(--color-muted)]">{p.description}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium tabular-nums">{rupees(p.price_cents)}{p.billing_interval ? `/${p.billing_interval}` : ""}</span>
                <button onClick={() => void purchase(p)} disabled={busyProductId === p.id}
                  className="rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {busyProductId === p.id ? "…" : "Buy"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-[var(--color-muted)]">Purchase history</h2>
        {!history ? (
          <p className="text-sm text-[var(--color-muted)]">Loading…</p>
        ) : history.transactions.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-line-strong)] px-5 py-8 text-center text-sm text-[var(--color-muted)]">
            No purchases yet.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-line)] rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-raised)]">
            {history.transactions.map((t) => (
              <li key={t.id} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <p className="text-sm font-medium">{t.product_id}</p>
                  <p className="text-xs text-[var(--color-muted)]">{new Date(t.created_at).toLocaleDateString()}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm tabular-nums">{rupees(t.amount_cents)}</p>
                  <StatusBadge status={t.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    captured: "text-emerald-700", failed: "text-red-600", refunded: "text-amber-700",
    partially_refunded: "text-amber-700", pending: "text-[var(--color-muted)]", disputed: "text-red-600",
  };
  return <p className={`text-xs ${styles[status] ?? "text-[var(--color-muted)]"}`}>{status}</p>;
}
