import type { Metadata } from "next";
import { Card, Eyebrow } from "@/components/ui";
import { PublicFooter } from "@/components/PublicFooter";

export const metadata: Metadata = {
  title: "Refund policy · AI Interviewer",
  description: "How refunds work for interview credits, subscriptions, top-ups, promotions and the free trial.",
};

/**
 * Public refund policy. No auth, no data access — a pure static render.
 *
 * Everything stated here about product behaviour was checked against the
 * implementation rather than assumed. Where the product does not yet define a
 * behaviour, the page says so openly instead of inventing one — see
 * `PENDING_DECISIONS` below, which is also what renders the on-page
 * "still being finalised" list.
 *
 * Deliberately absent, because fabricating any of it would be worse than
 * leaving a placeholder: company legal name, registered address, support
 * phone number, statutory refund windows, tax treatment, and governing
 * jurisdiction. Each is marked [TO BE COMPLETED] in the copy.
 */

/** Verified against the implementation before being stated as fact. */
const IMPLEMENTED = {
  creditsNeverExpire: true, // no expiry column or logic exists anywhere
  cancellationKeepsCredits: true, // handleSubscriptionEnded never claws back granted credits
  fullRefundReversesCredits: true, // capped at the unconsumed balance; never goes negative
  partialRefundNeedsReview: true, // recorded, credits deliberately not auto-reversed
  freeTrialIsTwoCredits: true, // source = 'free_trial'
};

/**
 * Open product decisions surfaced on the page. Listing them publicly is the
 * honest option while the policy is still a draft.
 */
const PENDING_DECISIONS = [
  "The exact refund request window (how many days after purchase a request can be made).",
  "How a partial refund converts into a specific number of credits, when only some of a pack has been used.",
  "Whether self-service subscription cancellation happens in-app or on request — the app currently shows renewal status but has no cancel button.",
];

export default function RefundPolicyPage() {
  return (
    <>
      <main className="mx-auto max-w-3xl px-5 pt-14 sm:px-6 sm:pt-20">
        <header className="animate-rise">
          <Eyebrow>Refund policy</Eyebrow>
          <h1 className="mt-3 text-[32px] font-semibold leading-[1.15] sm:text-4xl">Refund policy</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-[var(--color-muted)]">
            How refunds work for interview credits, subscriptions, top-ups, promotions and the free
            trial. Written to describe what the product actually does — where something
            isn&rsquo;t settled yet, this page says so rather than implying a rule.
          </p>
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            Last updated: <span className="font-medium">[TO BE COMPLETED — date at publication]</span>
          </p>
        </header>

        <Card className="mt-8 p-5">
          <h2 className="text-sm font-semibold">In short</h2>
          <ul className="mt-2.5 space-y-1.5 text-sm leading-relaxed text-[var(--color-ink-soft)]">
            <li>· Bought credits and used none of them? Ask us and we&rsquo;ll review a refund.</li>
            <li>· Used some of them? A refund may be limited to the unused part, case by case.</li>
            <li>· Charged twice, or charged in error? We&rsquo;ll fix that once verified.</li>
            <li>· Our fault an interview couldn&rsquo;t run? We restore the credit or refund it.</li>
            <li>· Didn&rsquo;t like your score? That isn&rsquo;t on its own grounds for a refund.</li>
            <li>· The two free interviews have no cash value and can&rsquo;t be refunded.</li>
          </ul>
        </Card>

        <Section id="what-you-buy" title="What you're buying">
          <p>
            Everything sold on this service is <strong>interview credits</strong>. One credit lets you
            run one interview. Credits sit in a single balance regardless of how you got them — a
            subscription, a top-up, a promotion, or the free trial — and any credit can be used for
            any kind of interview (topic-based, resume-based, or your own material).
          </p>
          <p>
            Currently available: a monthly subscription that adds interview credits each billing
            cycle, a one-time <strong>+5 interview</strong> top-up, and a one-time
            <strong> +10 interview</strong> top-up. Prices shown at checkout are the prices charged;
            the amount is always calculated on our server, including any discount.
          </p>
          {IMPLEMENTED.creditsNeverExpire && (
            <p>Credits do not currently expire. There is no expiry or forfeiture mechanism in the product.</p>
          )}
        </Section>

        <Section id="unused" title="Unused purchases">
          <p>
            If you bought credits and have <strong>not used any of them</strong>, you may request a
            refund within a reasonable period of the purchase
            (<Placeholder>exact window to be confirmed</Placeholder>). We&rsquo;ll review the request
            and, where it&rsquo;s approved, refund the purchase and remove the corresponding credits
            from your balance.
          </p>
        </Section>

        <Section id="partially-used" title="Partially used credit packs">
          <p>
            If some of the credits from a purchase have already been used, we can&rsquo;t promise a
            full refund. Refund eligibility in that case may be limited to the{" "}
            <strong>unused portion</strong> and is subject to review of your account and usage.
          </p>
          <p>
            We&rsquo;re being deliberately non-committal here rather than inventing a formula: the
            system records a partial refund and flags it for a person to review instead of
            automatically converting it into a credit adjustment. How that conversion should work is
            an open decision (see below).
          </p>
        </Section>

        <Section id="consumed" title="Interviews you've already taken">
          <p>
            An interview that has been substantially completed is not normally refundable simply
            because you were unhappy with the questions or the score. The service you paid for —
            the interview and its report — was delivered.
          </p>
          <p>
            That&rsquo;s separate from a technical failure, which is covered below, and separate from
            feedback: if the interviewer got something wrong, please tell us. It helps us improve the
            question bank and the evaluation even where it isn&rsquo;t a refund matter.
          </p>
        </Section>

        <Section id="technical" title="Technical failures on our side">
          <p>
            If a paid interview <strong>cannot be started</strong>, or is materially unusable because
            of a failure in our platform or one of the services we depend on (voice connection,
            speech recognition, speech synthesis, or the AI model), we&rsquo;ll put it right
            according to what actually happened — normally by restoring the credit, or by refunding
            it where restoring isn&rsquo;t appropriate.
          </p>
          <p>
            Please report these promptly, ideally with the approximate time, so we can match it to
            our own logs.
          </p>
        </Section>

        <Section id="duplicate" title="Duplicate or accidental charges">
          <p>
            Duplicate charges and clear payment-processing errors are eligible for correction or
            refund once verified against our payment records and the payment provider&rsquo;s.
          </p>
          <p>
            Our system is designed so a repeated payment notification cannot grant the same credits
            twice, but if you see two charges for one purchase, contact us and we&rsquo;ll check.
          </p>
        </Section>

        <Section id="failed" title="Failed payments">
          <p>
            A failed payment grants no credits and, as far as we&rsquo;re concerned, takes no money.
            If your bank or card statement shows a charge or hold for a payment that failed, that is
            usually a temporary authorisation released by your bank — contact us if it doesn&rsquo;t
            clear and we&rsquo;ll look into it with the payment provider.
          </p>
        </Section>

        <Section id="subscription" title="Subscription renewals">
          <p>
            A subscription charges on each billing cycle and adds that cycle&rsquo;s interview
            credits. To stop future charges, please{" "}
            <Placeholder>
              contact us to cancel — self-service in-app cancellation is not available yet
            </Placeholder>
            . Your billing page shows whether a subscription is set to renew or to end, and the date.
          </p>
          {IMPLEMENTED.cancellationKeepsCredits && (
            <p>
              <strong>Credits you already have stay yours.</strong> Cancelling, or a subscription
              lapsing or expiring, does not remove credits that were already granted — this is how
              the system behaves today, not just an intention. Cancelling stops future renewals and
              future credits; it isn&rsquo;t itself a refund of a cycle already charged.
            </p>
          )}
          <p>
            A refund request for the most recent renewal is treated under the unused/partially-used
            rules above.
          </p>
        </Section>

        <Section id="topups" title="+5 and +10 top-ups">
          <p>
            Top-ups are one-time purchases that add interview credits to the same single balance.
            They follow exactly the same principles as any other purchase: fully unused is
            reviewable for refund, partially used may be limited to the unused portion, and consumed
            interviews aren&rsquo;t refundable on the basis of dissatisfaction.
          </p>
          <p>
            The +10 top-up is priced below two +5 top-ups. If a partial refund on a discounted pack
            ever arises, the discount is taken into account rather than ignored.
          </p>
        </Section>

        <Section id="promotions" title="Promotional and discounted purchases">
          <p>
            Where a promotion or coupon reduced what you paid, any refund relates to the{" "}
            <strong>amount actually charged</strong>, not the undiscounted list price. Beyond that,
            refund treatment depends on the underlying purchase and on the specific terms of the
            promotion used. We don&rsquo;t apply blanket exclusions to discounted purchases.
          </p>
        </Section>

        <Section id="free-trial" title="Free trial">
          <p>
            New accounts receive {IMPLEMENTED.freeTrialIsTwoCredits ? "two" : "some"} free interview
            credits. These are promotional, have <strong>no cash value</strong>, and cannot be
            refunded, exchanged, or converted into money or account balance.
          </p>
        </Section>

        <Section id="how-to-request" title="How to request a refund">
          <p>
            Contact us at <Placeholder>support email address to be confirmed</Placeholder> with the
            account email you purchased under, roughly when the payment was made, and what
            went wrong. We aim to respond within{" "}
            <Placeholder>response time to be confirmed</Placeholder>.
          </p>
        </Section>

        <Section id="provider" title="How refunds are actually paid">
          <p>
            Payments are processed by our payment provider, and any approved refund is returned
            through the same method you paid with. The provider&rsquo;s own processing rules and
            timelines apply, so the money can take several days to appear depending on your bank or
            card issuer. We don&rsquo;t control that part of the timeline.
          </p>
          <p>
            If you dispute a charge with your bank instead of contacting us, the provider&rsquo;s
            dispute process takes over. That&rsquo;s your right, but it&rsquo;s usually slower than
            asking us first.
          </p>
        </Section>

        <Section id="pending" title="Still being finalised">
          <p>
            This policy is a working draft, and we&rsquo;d rather name the gaps than paper over them.
            These points are genuine open decisions:
          </p>
          <ul className="mt-2.5 space-y-1.5">
            {PENDING_DECISIONS.map((d) => (
              <li key={d} className="flex gap-2.5">
                <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-caution)]" />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Card className="mt-10 bg-[var(--color-sunken)] p-5">
          <h2 className="text-sm font-semibold">Before public launch</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
            The following still need to be filled in and are marked in the text above:
            legal entity name, registered address, support contact, the refund request window,
            response times, applicable tax treatment, and governing jurisdiction. We have
            deliberately not invented values for any of them.
          </p>
        </Card>

        <p className="mt-8 text-xs leading-relaxed text-[var(--color-muted)]">
          This policy is a product policy draft and may be updated as the service, payment methods,
          and applicable requirements evolve. It is not legal advice, and it does not claim
          compliance with the consumer-protection requirements of any particular country or region.
          Nothing here is intended to remove rights you may have under the law that applies to you.
        </p>
      </main>
      <PublicFooter />
    </>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="text-lg font-semibold">{title}</h2>
      <div className="mt-2.5 space-y-3 text-[15px] leading-relaxed text-[var(--color-muted)]">
        {children}
      </div>
    </section>
  );
}

/** Visibly marks an unfilled value so it can't ship unnoticed. */
function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <mark className="rounded bg-[var(--color-caution-wash)] px-1.5 py-0.5 text-[var(--color-ink-soft)]">
      [TO BE COMPLETED — {children}]
    </mark>
  );
}
